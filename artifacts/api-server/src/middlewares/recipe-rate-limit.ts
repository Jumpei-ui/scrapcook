import { createHmac } from "node:crypto";
import type { RequestHandler } from "express";
import { pool } from "@workspace/db";

const limit = 20;
let ready: Promise<unknown> | undefined;
let nextCleanup = 0;

async function ensureStore() {
  ready ??= pool.query(`
    CREATE TABLE IF NOT EXISTS recipe_rate_limits (
      client_hash text PRIMARY KEY,
      request_times timestamptz[] NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS recipe_daily_usage (
      usage_day date PRIMARY KEY,
      used integer NOT NULL CHECK (used >= 0)
    )
  `).catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  await ready;
  if (Date.now() >= nextCleanup) {
    nextCleanup = Date.now() + 60_000;
    await pool.query("DELETE FROM recipe_rate_limits WHERE updated_at < now() - interval '1 hour'");
  }
}

// Both scan modes share one rolling-hour allowance, persisted like recipe limits.
export const scanRateLimit: RequestHandler = async (req, res, next) => {
  const scanLimit = res.locals.chefPro ? 120 : 10;
  try {
    const secret = process.env.SESSION_SECRET;
    if (!secret || !req.ip) throw new Error("Scan identity unavailable.");
    await ensureStore();
    const hash = createHmac("sha256", secret).update(`scan:${req.ip}`).digest("hex");
    const result = await pool.query<{ used: number }>(`
      INSERT INTO recipe_rate_limits (client_hash, request_times)
      VALUES ($1, ARRAY[clock_timestamp()])
      ON CONFLICT (client_hash) DO UPDATE SET
        request_times = array_append(ARRAY(
          SELECT t FROM unnest(recipe_rate_limits.request_times) AS t
          WHERE t > clock_timestamp() - interval '1 hour'
        ), clock_timestamp()), updated_at = clock_timestamp()
      WHERE cardinality(ARRAY(
        SELECT t FROM unnest(recipe_rate_limits.request_times) AS t
        WHERE t > clock_timestamp() - interval '1 hour'
      )) < $2
      RETURNING cardinality(request_times) AS used
    `, [hash, scanLimit]);
    res.setHeader("RateLimit-Limit", String(scanLimit));
    res.setHeader("RateLimit-Remaining", String(scanLimit - (result.rows[0]?.used ?? scanLimit)));
    if (!result.rows.length) {
      // Conservative retry window avoids revealing private allowance timestamps.
      res.setHeader("Retry-After", "3600");
      res.status(429).json({ error: `Scan anti-abuse limit reached: ${scanLimit} scans per hour. Please try again later.` });
      return;
    }
    next();
  } catch {
    res.status(503).json({ error: "Scan rate limiting is unavailable. Please try again later." });
  }
};

export const recipeRateLimit: RequestHandler = async (req, res, next) => {
  try {
    const configuredLimit = process.env.RECIPE_DAILY_LIMIT;
    // Missing or malformed owner configuration must never silently disable the cap.
    if (!configuredLimit || !/^\d+$/.test(configuredLimit)) {
      throw new Error("Daily recipe limit is not configured.");
    }
    const dailyLimit = Number(configuredLimit);
    if (!Number.isSafeInteger(dailyLimit) || dailyLimit > 2_147_483_647) {
      throw new Error("Daily recipe limit is invalid.");
    }
    const secret = process.env.SESSION_SECRET;
    if (!secret || !req.ip) throw new Error("Rate limit identity is unavailable.");
    const clientHash = createHmac("sha256", secret).update(req.ip).digest("hex");
    await ensureStore();
    // PostgreSQL locks the conflicting row; the limit stays atomic across instances.
    const result = await pool.query<{ used: number }>(`
      INSERT INTO recipe_rate_limits (client_hash, request_times)
      VALUES ($1, ARRAY[clock_timestamp()])
      ON CONFLICT (client_hash) DO UPDATE SET
        request_times = array_append(
          ARRAY(SELECT t FROM unnest(recipe_rate_limits.request_times) AS t
                WHERE t > clock_timestamp() - interval '1 hour'), clock_timestamp()),
        updated_at = clock_timestamp()
      WHERE cardinality(ARRAY(
        SELECT t FROM unnest(recipe_rate_limits.request_times) AS t
        WHERE t > clock_timestamp() - interval '1 hour'
      )) < $2
      RETURNING cardinality(request_times) AS used
    `, [clientHash, limit]);
    res.setHeader("RateLimit-Limit", String(limit));
    if (!result.rows.length) {
      const reset = await pool.query<{ seconds: number }>(`
        SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
          (SELECT MIN(t) FROM unnest(request_times) AS t
           WHERE t > clock_timestamp() - interval '1 hour')
          + interval '1 hour' - clock_timestamp()
        )))) AS seconds
        FROM recipe_rate_limits WHERE client_hash = $1
      `, [clientHash]);
      res.setHeader("Retry-After", String(Number(reset.rows[0]?.seconds) || 3600));
      res.setHeader("RateLimit-Remaining", "0");
      res.status(429).json({ error: "Recipe limit reached: 20 requests per hour. Please try again later." });
      return;
    }
    res.setHeader("RateLimit-Remaining", String(limit - result.rows[0].used));
    // Personal requests pay with personal keys, but still obey the per-IP throttle.
    if (res.locals.personalProviderKeys) {
      next();
      return;
    }

    // Reserve one generation attempt before any provider calls. ON CONFLICT locks
    // today's row, so concurrent requests and replicas cannot exceed the allowance.
    // Do not refund failures: a failed generation may already have consumed credits.
    const daily = await pool.query<{ used: number | null; seconds: number }>(`
      WITH today AS (
        SELECT (statement_timestamp() AT TIME ZONE 'UTC')::date AS day
      ), reservation AS (
        INSERT INTO recipe_daily_usage (usage_day, used)
        SELECT day, 1 FROM today WHERE $1::integer > 0
        ON CONFLICT (usage_day) DO UPDATE SET used = recipe_daily_usage.used + 1
        WHERE recipe_daily_usage.used < $1::integer
        RETURNING used
      )
      SELECT (SELECT used FROM reservation) AS used,
        GREATEST(1, CEIL(EXTRACT(EPOCH FROM (
          ((day + 1)::timestamp AT TIME ZONE 'UTC') - statement_timestamp()
        ))))::integer AS seconds
      FROM today
    `, [dailyLimit]);
    const usage = daily.rows[0];
    if (!usage) throw new Error("Daily recipe counter is unavailable.");
    // Shared usage figures belong only on the password-protected owner page.
    if (usage.used === null) {
      res.setHeader("Retry-After", String(usage.seconds));
      res.status(429).json({
        error: "The daily recipe generation limit has been reached. Please try again after midnight UTC.",
      });
      return;
    }
    next();
  } catch {
    req.log.error("Recipe rate-limit storage or configuration is unavailable; generation blocked.");
    res.status(503).json({ error: "Recipe service is temporarily unavailable. Please try again later." });
  }
};
