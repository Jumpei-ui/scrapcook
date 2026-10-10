import { Router, type Request, type RequestHandler } from "express";
import { pool } from "@workspace/db";
import { getAuth } from "@clerk/express";
import { getUncachableStripeClient, getStripeSync } from "../lib/stripe-client";
import { chefPriceId, customerFor, entitlement, verifiedActor, freeRemaining, nextUtcMidnight, limitsNotice } from "../lib/chef-store";
import { portalConfiguration } from "../lib/chef-stripe";
const router = Router();

function publicOrigin(req: Request) {
  const host = (req.get("x-forwarded-host") ?? req.get("host") ?? "").split(",")[0].trim();
  const allowed = [...(process.env.REPLIT_DOMAINS ?? "").split(","),
    process.env.REPLIT_DEV_DOMAIN ?? "", ...(process.env.APP_PUBLIC_DOMAINS ?? "").split(",")];
  if (!allowed.includes(host)) throw new Error("Unrecognized checkout origin.");
  return `https://${host}`;
}
const requireCustomer: RequestHandler = async (req, res, next) => {
  try {
    const actor = await verifiedActor(req);
    if (!actor) { res.status(401).json({ error: "Sign in with a verified email to continue." }); return; }
    const origin = publicOrigin(req);
    if (req.get("origin") && req.get("origin") !== origin) {
      res.status(403).json({ error: "Invalid billing origin." }); return;
    }
    if (!chefPriceId) { res.status(503).json({ error: "Billing is not ready. Please try again shortly." }); return; }
    res.locals.chefActor = actor; res.locals.billingOrigin = origin; next();
  } catch { res.status(503).json({ error: "Billing verification is temporarily unavailable." }); }
};
router.post("/create-checkout", requireCustomer, async (_req, res) => {
  try {
    const actor = res.locals.chefActor;
    const stripe = await getUncachableStripeClient();
    if ((await entitlement(actor.userId)).isPro) {
      res.status(409).json({ error: "Chef's Edition is already active. Use Manage Subscription." }); return;
    }
    let customer = await customerFor(actor.userId);
    if (!customer) {
      const created = await stripe.customers.create({ email: actor.email, metadata: { userId: actor.userId, scrapcook_plan: "chef" } },
        { idempotencyKey: `scrapcook-customer-${actor.userId}` });
      await pool.query("INSERT INTO chef_customers(user_id,customer_id) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING", [actor.userId, created.id]);
      customer = await customerFor(actor.userId);
    }
    // Resume unfinished checkout before blocking an incomplete subscription.
    const open = await stripe.checkout.sessions.list({ customer, status: "open", limit: 100 });
    const reusable = open.data.find(s => s.metadata?.scrapcook_plan === "chef" && s.client_reference_id === actor.userId);
    if (reusable?.url) { res.json({ url: reusable.url }); return; }
    const existing = await stripe.subscriptions.list({ customer, limit: 100, status: "all" });
    if (existing.data.some(s => ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(s.status) &&
      s.items.data.some(item => item.price.id === chefPriceId))) {
      res.status(409).json({ error: "A subscription already exists. Restore or manage it in Settings." }); return;
    }
    // Concurrent clicks share a key; an expired/cancelled prior checkout gets
    // a new key rather than reopening an expired session from this hour.
    const previous = (await stripe.checkout.sessions.list({ customer, limit: 1 })).data[0];
    const session = await stripe.checkout.sessions.create({
      mode: "subscription", customer, client_reference_id: actor.userId,
      line_items: [{ price: chefPriceId, quantity: 1 }],
      metadata: { scrapcook_plan: "chef", userId: actor.userId },
      subscription_data: { metadata: { scrapcook_plan: "chef", userId: actor.userId } },
      success_url: `${res.locals.billingOrigin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${res.locals.billingOrigin}/`,
      custom_text: { submit: { message: "USD10/month, recurring. Cancel anytime. No personal daily quota; shared safety caps and anti-abuse limits apply." } },
    }, { idempotencyKey: `scrapcook-checkout-${actor.userId}-${previous?.id ?? "first"}` });
    if (!session.url) throw new Error("Checkout unavailable.");
    res.json({ url: session.url });
  } catch { res.status(503).json({ error: "Could not open Stripe checkout. Please try again." }); }
});
router.post("/customer-portal", requireCustomer, async (_req, res) => {
  try {
    const customer = await customerFor(res.locals.chefActor.userId);
    if (!customer) { res.status(404).json({ error: "No purchase found for this verified account." }); return; }
    const stripe = await getUncachableStripeClient();
    const portal = await stripe.billingPortal.sessions.create({
      customer, configuration: portalConfiguration, return_url: `${res.locals.billingOrigin}/settings`,
    });
    res.json({ url: portal.url });
  } catch { res.status(503).json({ error: "Could not open subscription management. Please try again." }); }
});
router.get("/subscription-status", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const actor = getAuth(req).userId ? await verifiedActor(req) : null;
    if (req.query.email || req.query.session_id) {
      if (!actor) { res.status(401).json({ error: "Sign in to verify your purchase." }); return; }
      if (req.query.email && (typeof req.query.email !== "string" ||
        req.query.email.trim().toLowerCase() !== actor.email.toLowerCase())) {
        res.status(403).json({ error: "Sign in with the verified email used for your purchase." }); return;
      }
      if (!chefPriceId) { res.status(503).json({ error: "Billing is not ready." }); return; }
      const stripe = await getUncachableStripeClient();
      const sync = await getStripeSync();
      if (req.query.session_id) {
        if (typeof req.query.session_id !== "string" || !/^cs_[a-zA-Z0-9_]{10,240}$/.test(req.query.session_id)) {
          res.status(400).json({ error: "Invalid checkout receipt." }); return;
        }
        const receipt = await stripe.checkout.sessions.retrieve(req.query.session_id);
        const customer = await customerFor(actor.userId);
        if (receipt.client_reference_id !== actor.userId || receipt.customer !== customer ||
          receipt.metadata?.scrapcook_plan !== "chef") {
          res.status(404).json({ error: "Purchase not found for this account." }); return;
        }
        if (receipt.status !== "complete" || receipt.payment_status !== "paid" || typeof receipt.subscription !== "string") {
          res.status(409).json({ error: "Payment is not complete yet. Please wait or return to checkout." }); return;
        }
        await sync.syncSingleEntity(receipt.subscription);
      } else {
        const customer = await customerFor(actor.userId);
        if (customer) {
          const subscriptions = await stripe.subscriptions.list({ customer, status: "all", limit: 100 });
          await Promise.all(subscriptions.data.filter(s => s.metadata.userId === actor.userId &&
            s.items.data.some(i => i.price.id === chefPriceId)).map(s => sync.syncSingleEntity(s.id)));
        }
      }
    }
    res.json({ ...(await entitlement(actor?.userId)), email: actor?.email ?? null,
      freeRemaining: await freeRemaining(req), resetsAt: nextUtcMidnight(),
      billingReady: !!chefPriceId, limitsNotice });
  } catch { res.status(503).json({ error: "Could not verify your subscription. Please try again." }); }
});
export const chefWebhook: RequestHandler = async (req, res) => {
  const signature = req.get("stripe-signature");
  if (!signature || !Buffer.isBuffer(req.body)) { res.status(400).json({ error: "Invalid webhook signature or body." }); return; }
  try {
    const sync = await getStripeSync();
    await sync.processWebhook(req.body, signature);
    // Only parse AFTER signature verification. Refresh canonical subscription state
    // to prevent delayed/out-of-order events from reviving a cancelled subscription.
    const event = JSON.parse(req.body.toString());
    let id = event.data?.object?.subscription;
    if (event.type.startsWith("customer.subscription.")) id = event.data?.object?.id;
    if (!id && event.type.startsWith("invoice.")) id = event.data?.object?.parent?.subscription_details?.subscription;
    if (typeof id === "string" && id.startsWith("sub_")) await sync.syncSingleEntity(id);
    res.json({ received: true });
  } catch (error) {
    const invalid = error instanceof SyntaxError ||
      (error instanceof Error && "type" in error && error.type === "StripeSignatureVerificationError");
    res.status(invalid ? 400 : 503).json({
      error: invalid ? "Invalid webhook signature or body." : "Webhook processing is temporarily unavailable.",
    });
  }
};
export default router;
