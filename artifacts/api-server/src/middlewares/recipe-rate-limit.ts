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

export const recipeRateLimit: RequestHandler = async (req, res, next) => {
  try {
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
    next();
  } catch {
    req.log.error("Recipe rate-limit storage is unavailable; generation blocked.");
    res.status(503).json({ error: "Recipe service is temporarily unavailable. Please try again later." });
  }
};
