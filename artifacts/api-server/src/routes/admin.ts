import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { adminPage } from "../lib/admin-page";
import { allowAdminSignIn, getRecipeUsage, recordProviderCall, resetRecipeUsage } from "../lib/recipe-usage";
import { forceResumeRecipes, getRecipePauseState, publicRecipePause, reserveProviderAllowance } from "../lib/recipe-pause";

const router = Router();
const cookieName = "scrapcook_admin";
const sessionDuration = 60 * 60 * 1000;

function matches(value: unknown, expected: string | undefined) {
  return typeof value === "string" && Boolean(expected)
    && timingSafeEqual(createHash("sha256").update(value).digest(), createHash("sha256").update(expected!).digest());
}

function sessionMac(expiry: string) {
  return createHmac("sha256", process.env.ADMIN_PASSWORD!).update(`scrapcook-admin:${expiry}`).digest("hex");
}

function authenticated(req: Request) {
  const value = req.signedCookies?.[cookieName];
  if (!process.env.ADMIN_PASSWORD || typeof value !== "string") return false;
  const [expiry, mac] = value.split(":");
  return /^\d+$/.test(expiry) && Number(expiry) > Date.now()
    && matches(mac, sessionMac(expiry));
}

function signIn(req: Request, res: Response) {
  const expiry = String(Date.now() + sessionDuration);
  res.cookie(cookieName, `${expiry}:${sessionMac(expiry)}`, {
    signed: true, httpOnly: true, sameSite: "strict", secure: req.secure,
    path: "/", maxAge: sessionDuration,
  });
}

async function passwordAccepted(req: Request, value: unknown) {
  if (!process.env.ADMIN_PASSWORD || typeof value !== "string" || value.length > 4096) return false;
  try {
    return await allowAdminSignIn(req.ip) && matches(value, process.env.ADMIN_PASSWORD);
  } catch {
    req.log.error("Admin sign-in protection is unavailable");
    return false;
  }
}

function csrf(req: Request) {
  return createHmac("sha256", process.env.SESSION_SECRET!)
    .update(`scrapcook-admin-reset:${req.signedCookies[cookieName]}`).digest("hex");
}

function privateHeaders(res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

function notFound(res: Response) {
  privateHeaders(res);
  res.status(404).type("text").send("Not Found");
}

router.get("/admin", async (req, res) => {
  privateHeaders(res);
  if (req.query.key !== undefined) {
    if (!await passwordAccepted(req, req.query.key)) return notFound(res);
    signIn(req, res);
    res.redirect(303, "/admin");
    return;
  }
  if (!authenticated(req)) return notFound(res);
  const nonce = randomBytes(18).toString("base64");
  res.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'`);
  res.type("html").send(adminPage(csrf(req), nonce));
});

// Password-in-body login is available for clients that avoid secret URLs entirely.
router.post("/api/admin/login", async (req, res) => {
  privateHeaders(res);
  if (!await passwordAccepted(req, req.body?.password)) return notFound(res);
  signIn(req, res);
  res.sendStatus(204);
});

router.get("/api/admin/usage", async (req, res) => {
  if (!authenticated(req)) return notFound(res);
  privateHeaders(res);
  try {
    res.json({ ...await getRecipeUsage(), pause: await getRecipePauseState() });
  } catch {
    req.log.error("Private recipe usage storage is unavailable");
    res.status(503).json({ error: "Usage storage is unavailable." });
  }
});

router.post("/api/admin/reset", async (req, res) => {
  if (!authenticated(req) || !matches(req.header("x-admin-csrf"), csrf(req))) return notFound(res);
  privateHeaders(res);
  try {
    // Initialize the protective ledger before clearing legacy reporting counts.
    await getRecipePauseState();
    res.json({ ...await resetRecipeUsage(), pause: await getRecipePauseState() });
  } catch {
    req.log.error("Private recipe usage storage is unavailable");
    res.status(503).json({ error: "Usage storage is unavailable." });
  }
});

router.post("/api/admin/resume", async (req, res) => {
  if (!authenticated(req) || !matches(req.header("x-admin-csrf"), csrf(req))) return notFound(res);
  privateHeaders(res);
  if (req.body?.acceptCharges !== true) {
    res.status(400).json({ error: "Explicit acceptance of possible charges is required." });
    return;
  }
  try {
    const pause = await forceResumeRecipes();
    res.json({ ...await getRecipeUsage(), pause });
  } catch {
    res.status(503).json({ error: "Could not resume recipes. Please try again." });
  }
});

router.post("/api/internal/provider-usage", async (req, res) => {
  const secret = process.env.SESSION_SECRET;
  const expected = secret && createHmac("sha256", secret).update("scrapcook-provider-usage").digest("hex");
  if (!matches(req.header("x-internal-usage"), expected)) return notFound(res);
  const provider = req.body?.provider;
  if (provider !== "spoon" && provider !== "gemini") {
    res.status(400).json({ error: "Invalid provider." });
    return;
  }
  try {
    if (!await reserveProviderAllowance(provider)) {
      res.status(429).json(publicRecipePause(await getRecipePauseState()));
      return;
    }
    await recordProviderCall(provider);
    res.sendStatus(204);
  } catch {
    req.log.error("Provider usage could not be recorded");
    res.status(503).json({ error: "Usage storage is unavailable." });
  }
});

export default router;
