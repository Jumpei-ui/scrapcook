import { createHash } from "node:crypto";
import OpenAI from "openai";
import { Router, type IRouter, type Request, type Response } from "express";
import savingsRouter from "./savings";

const router: IRouter = Router();
const pythonPort = Number(process.env.SCRAPCOOK_PY_PORT ?? 5087);
const instructionCacheTtlMs = 24 * 60 * 60 * 1000;
const instructionCache = new Map<string, { expiresAt: number; instructions: string[] }>();

async function callPython(req: Request): Promise<globalThis.Response> {
  const headers = new Headers();
  const contentType = req.header("content-type");
  const cookie = req.header("cookie");
  const forwardedProto = req.header("x-forwarded-proto");
  const forwardedHost = req.header("x-forwarded-host");

  if (contentType) headers.set("content-type", contentType);
  if (cookie) headers.set("cookie", cookie);
  if (forwardedProto) headers.set("x-forwarded-proto", forwardedProto);
  if (forwardedHost) headers.set("x-forwarded-host", forwardedHost);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return fetch(`http://127.0.0.1:${pythonPort}${req.originalUrl}`, {
    method: req.method,
    headers,
    body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
    signal: AbortSignal.timeout(25_000),
  });
}

function relayPythonResponse(res: Response, upstream: globalThis.Response, body: string): void {
  const responseType = upstream.headers.get("content-type");
  const setCookie = upstream.headers.get("set-cookie");
  if (responseType) res.setHeader("content-type", responseType);
  if (setCookie) res.append("set-cookie", setCookie);
  res.status(upstream.status).send(body);
}

function instructionCacheKey(recipeId: string, instructions: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify([recipeId, instructions]))
    .digest("hex");
}

function readCachedInstructions(key: string): string[] | undefined {
  const cached = instructionCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    instructionCache.delete(key);
    return undefined;
  }
  return cached.instructions;
}

function writeCachedInstructions(key: string, instructions: string[]): void {
  const now = Date.now();
  for (const [cacheKey, value] of instructionCache) {
    if (value.expiresAt <= now) instructionCache.delete(cacheKey);
  }
  instructionCache.set(key, {
    expiresAt: now + instructionCacheTtlMs,
    instructions,
  });
}

async function simplifyInstructions(
  apiKey: string,
  title: string,
  instructions: string[],
): Promise<string[]> {
  const openai = new OpenAI({ apiKey });
  const response = await openai.chat.completions.create(
    {
      model: "gpt-5-mini",
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Rewrite only the supplied recipe instructions for a student cook. Keep the same number and order of steps. Use plain, direct language. Preserve all ingredients, quantities, temperatures, timings, and food-safety instructions exactly. Do not add steps, ingredients, tips, or recipe content. Return a JSON object with one property, instructions, containing an array of strings.",
        },
        {
          role: "user",
          content: JSON.stringify({ recipe: title, instructions }),
        },
      ],
    },
    { signal: AbortSignal.timeout(35_000) },
  );
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned no simplified instructions.");

  const parsed: unknown = JSON.parse(content);
  if (!parsed || typeof parsed !== "object" || !("instructions" in parsed)) {
    throw new Error("OpenAI returned an invalid instruction format.");
  }
  const rewritten = (parsed as { instructions?: unknown }).instructions;
  if (
    !Array.isArray(rewritten)
    || rewritten.length !== instructions.length
    || rewritten.some((step) => typeof step !== "string" || !step.trim())
  ) {
    throw new Error("OpenAI returned an incomplete instruction list.");
  }
  return rewritten;
}

router.use("/scrapcook/savings", savingsRouter);

router.get("/scrapcook/recipes/:recipeId", async (req, res): Promise<void> => {
  try {
    const upstream = await callPython(req);
    const body = await upstream.text();
    if (!upstream.ok) {
      relayPythonResponse(res, upstream, body);
      return;
    }

    const recipe: unknown = JSON.parse(body);
    if (!recipe || typeof recipe !== "object" || Array.isArray(recipe)) {
      relayPythonResponse(res, upstream, body);
      return;
    }
    const detail = recipe as Record<string, unknown>;
    const originalInstructions = detail.instructions;
    if (
      typeof detail.id !== "string"
      || typeof detail.title !== "string"
      || !Array.isArray(originalInstructions)
      || originalInstructions.some((step) => typeof step !== "string")
    ) {
      relayPythonResponse(res, upstream, body);
      return;
    }

    const instructions = originalInstructions as string[];
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      detail.instructionsSimplified = false;
      detail.instructionsNote =
        "Student-friendly steps need an OpenAI API key. Showing the original instructions.";
      res.status(upstream.status).json(detail);
      return;
    }

    const cacheKey = instructionCacheKey(detail.id, instructions);
    try {
      const simplified =
        readCachedInstructions(cacheKey)
        ?? await simplifyInstructions(apiKey, detail.title, instructions);
      writeCachedInstructions(cacheKey, simplified);
      detail.instructions = simplified;
      detail.instructionsSimplified = true;
      detail.instructionsNote = null;
    } catch (error) {
      req.log.warn({ err: error, recipeId: detail.id }, "Could not simplify recipe instructions");
      detail.instructionsSimplified = false;
      detail.instructionsNote =
        "We couldn't simplify these steps right now, so you're seeing the original instructions.";
    }

    res.status(upstream.status).json(detail);
  } catch (error) {
    req.log.error({ err: error }, "ScrapCook recipe detail request failed");
    res.status(502).json({ error: "Could not load this recipe right now. Please try again." });
  }
});

router.use("/scrapcook", async (req, res) => {
  try {
    const upstream = await callPython(req);
    relayPythonResponse(res, upstream, await upstream.text());
  } catch (error) {
    req.log.error({ err: error }, "ScrapCook Python API is unavailable");
    res.status(502).json({ error: "The recipe service is starting up. Please try again in a moment." });
  }
});

export default router;