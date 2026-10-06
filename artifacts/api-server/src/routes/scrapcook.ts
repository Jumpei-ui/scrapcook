import { Router, type IRouter, type Request, type Response } from "express";
import savingsRouter from "./savings";

const router: IRouter = Router();
const pythonPort = Number(process.env.SCRAPCOOK_PY_PORT ?? 5087);

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
    signal: AbortSignal.timeout(req.method === "POST" && req.originalUrl.endsWith("/recipes") ? 180_000 : 25_000),
  });
}

function relayPythonResponse(res: Response, upstream: globalThis.Response, body: string): void {
  const responseType = upstream.headers.get("content-type");
  const setCookie = upstream.headers.get("set-cookie");
  if (responseType) res.setHeader("content-type", responseType);
  if (setCookie) res.append("set-cookie", setCookie);
  res.status(upstream.status).send(body);
}

router.use("/scrapcook/savings", savingsRouter);

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