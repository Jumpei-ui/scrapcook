import { Router, type IRouter, type Request, type Response } from "express";
import savingsRouter from "./savings";
import { recipeRateLimit } from "../middlewares/recipe-rate-limit";

const router: IRouter = Router();
const pythonPort = Number(process.env.SCRAPCOOK_PY_PORT ?? 5087);

async function callPython(req: Request): Promise<globalThis.Response> {
  const headers = new Headers();
  const contentType = req.header("content-type");
  const cookie = req.header("cookie");
  const forwardedProto = req.header("x-forwarded-proto");
  const forwardedHost = req.header("x-forwarded-host");
  const showNutrition = req.header("x-show-nutrition");

  if (contentType) headers.set("content-type", contentType);
  if (cookie) headers.set("cookie", cookie);
  if (forwardedProto) headers.set("x-forwarded-proto", forwardedProto);
  if (forwardedHost) headers.set("x-forwarded-host", forwardedHost);
  if (showNutrition === "true" || showNutrition === "false") headers.set("x-show-nutrition", showNutrition);

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return fetch(`http://127.0.0.1:${pythonPort}${req.originalUrl}`, {
    method: req.method,
    headers,
    body: hasBody ? JSON.stringify(req.body ?? {}) : undefined,
    signal: AbortSignal.timeout(req.method === "POST" && req.originalUrl.endsWith("/recipes") ? 180_000 : 25_000),
  });
}

function relayPythonResponse(res: Response, upstream: globalThis.Response, body: string): void {
  const responseType = upstream.headers.get("content-type");
  if (responseType) res.setHeader("content-type", responseType);
  for (const cookie of upstream.headers.getSetCookie()) res.append("set-cookie", cookie);
  res.status(upstream.status).send(body);
}

router.use("/scrapcook/savings", savingsRouter);

// Keep the old generation URL behind the same limiter; it must not be a bypass.
router.post(["/recipes", "/scrapcook/recipes"], recipeRateLimit, async (req, res) => {
  try {
    const upstream = await callPython(req);
    relayPythonResponse(res, upstream, await upstream.text());
  } catch {
    req.log.error("ScrapCook Python API is unavailable");
    res.status(502).json({ error: "The recipe service is starting up. Please try again in a moment." });
  }
});

router.use("/scrapcook", async (req, res) => {
  try {
    const upstream = await callPython(req);
    relayPythonResponse(res, upstream, await upstream.text());
  } catch {
    req.log.error("ScrapCook Python API is unavailable");
    res.status(502).json({ error: "The recipe service is starting up. Please try again in a moment." });
  }
});

export default router;