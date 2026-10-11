import { createHmac } from "node:crypto";
import { pool } from "@workspace/db";
import { getAuth, clerkClient } from "@clerk/express";
import type { Request, RequestHandler } from "express";

export const limitsNotice = "Unlimited personal daily generations and scans. Shared daily safety caps and hourly anti-abuse limits still apply.";
let store: Promise<unknown> | undefined;
export let chefPriceId = "";
export function setChefPriceId(id: string) { chefPriceId = id; }
export function ensureChefStore() {
  store ??= pool.query(`
    CREATE TABLE IF NOT EXISTS chef_customers (
      user_id text PRIMARY KEY, customer_id text UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chef_free_usage (
      client_hash text NOT NULL, usage_day date NOT NULL, used integer NOT NULL CHECK (used >= 0),
      PRIMARY KEY(client_hash, usage_day)
    )
  `).catch((error: unknown) => { store = undefined; throw error; });
  return store;
}
export function clientHash(req: Request) {
  if (!req.ip || !process.env.SESSION_SECRET) throw new Error("Recipe identity unavailable.");
  return createHmac("sha256", process.env.SESSION_SECRET).update(`chef-free:${req.ip}`).digest("hex");
}
export async function verifiedActor(req: Request) {
  const userId = getAuth(req).userId;
  if (!userId) return null;
  const user = await clerkClient.users.getUser(userId);
  const email = user.emailAddresses.find(value => value.id === user.primaryEmailAddressId &&
    value.verification?.status === "verified")?.emailAddress;
  return email ? { userId, email } : null;
}
export async function customerFor(userId: string) {
  await ensureChefStore();
  return (await pool.query<{ customer_id: string }>(
    "SELECT customer_id FROM chef_customers WHERE user_id=$1", [userId],
  )).rows[0]?.customer_id;
}
export async function entitlement(userId: string | null | undefined) {
  const inactive = { isPro: false, expiresAt: null, isTrial: false, trialEnds: null,
    trialDaysLeft: 0, willBeChargedOn: null };
  if (!userId || !chefPriceId) return inactive;
  await ensureChefStore();
  const { rows } = await pool.query<{ expires_at: Date; is_trial: boolean; will_charge: boolean }>(`
    SELECT to_timestamp(CASE WHEN s._raw_data->>'status'='trialing'
      THEN (s._raw_data->>'trial_end')::double precision
      ELSE COALESCE(s._raw_data->>'current_period_end',
        s._raw_data#>>'{items,data,0,current_period_end}')::double precision END) AS expires_at,
      s._raw_data->>'status'='trialing' AS is_trial,
      NOT COALESCE((s._raw_data->>'cancel_at_period_end')::boolean, false)
        AND s._raw_data->>'cancel_at' IS NULL AS will_charge
    FROM stripe.subscriptions s JOIN chef_customers c ON c.customer_id=s._raw_data->>'customer'
    WHERE c.user_id=$1 AND s._raw_data->>'status' IN ('active','trialing')
      AND s._raw_data#>>'{metadata,userId}'=$1
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(s._raw_data#>'{items,data}') item
        WHERE item#>>'{price,id}'=$2)
      AND CASE WHEN s._raw_data->>'status'='trialing'
        THEN (s._raw_data->>'trial_end')::double precision
        ELSE COALESCE(s._raw_data->>'current_period_end',
          s._raw_data#>>'{items,data,0,current_period_end}')::double precision END > EXTRACT(EPOCH FROM now())
    ORDER BY expires_at DESC LIMIT 1
  `, [userId, chefPriceId]);
  const row = rows[0];
  if (!row) return inactive;
  const trialEnds = row.is_trial ? row.expires_at.getTime() : null;
  return { isPro: true, expiresAt: row.expires_at.toISOString(), isTrial: row.is_trial,
    trialEnds, trialDaysLeft: trialEnds ? Math.max(0, Math.ceil((trialEnds - Date.now()) / 86400000)) : 0,
    willBeChargedOn: row.is_trial && row.will_charge
      ? row.expires_at.toLocaleDateString("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }) : null };
}
export function nextUtcMidnight() {
  const next = new Date(); next.setUTCHours(24, 0, 0, 0); return next.toISOString();
}
export async function freeRemaining(req: Request) {
  await ensureChefStore();
  const result = await pool.query<{ used: number }>(
    "SELECT used FROM chef_free_usage WHERE client_hash=$1 AND usage_day=(now() AT TIME ZONE 'UTC')::date", [clientHash(req)],
  );
  return Math.max(0, 3 - (result.rows[0]?.used ?? 0));
}
// Server-verified identity only. X-Pro-Email, query emails and browser storage never grant access.
export const chefIdentity: RequestHandler = async (req, res, next) => {
  try {
    const userId = getAuth(req).userId;
    res.locals.chefUserId = userId;
    res.locals.chefPro = (await entitlement(userId)).isPro;
    next();
  } catch {
    res.status(503).json({ error: "Subscription verification is temporarily unavailable." });
  }
};
export const freeRecipeQuota: RequestHandler = async (req, res, next) => {
  if (res.locals.chefPro || res.locals.personalProviderKeys) { next(); return; }
  try {
    await ensureChefStore();
    await pool.query("DELETE FROM chef_free_usage WHERE usage_day < (now() AT TIME ZONE 'UTC')::date - 2");
    const result = await pool.query(`
      INSERT INTO chef_free_usage(client_hash,usage_day,used)
      VALUES($1,(now() AT TIME ZONE 'UTC')::date,1)
      ON CONFLICT(client_hash,usage_day) DO UPDATE SET used=chef_free_usage.used+1
      WHERE chef_free_usage.used < 3 RETURNING used
    `, [clientHash(req)]);
    if (!result.rows.length) {
      res.status(429).json({ freeLimit: true,
        message: "Free limit: 3/day. Upgrade to Chef's Edition for unlimited",
        resetsAt: nextUtcMidnight() }); return;
    }
    // Attempts may have spent provider credits even when a provider fails.
    next();
  } catch {
    res.status(503).json({ error: "Free recipe allowance is temporarily unavailable." });
  }
};
