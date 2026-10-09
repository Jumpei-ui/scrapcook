import { pool, type RecipeUsage } from "@workspace/db";
import { createHmac } from "node:crypto";

const today = "(now() AT TIME ZONE 'UTC')::date";
let ready: Promise<unknown> | undefined;
let nextCleanup = 0;

export async function ensureUsageStore() {
  ready ??= pool.query(`
    CREATE TABLE IF NOT EXISTS scrapcook_recipe_usage (
      usage_date date PRIMARY KEY,
      spoon integer NOT NULL DEFAULT 0,
      gemini integer NOT NULL DEFAULT 0,
      total_requests integer NOT NULL DEFAULT 0,
      recent_requests jsonb NOT NULL DEFAULT '[]'::jsonb
    );
    CREATE TABLE IF NOT EXISTS scrapcook_admin_attempts (
      client_hash text PRIMARY KEY,
      request_times timestamptz[] NOT NULL
    );
  `).catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  await ready;
  if (Date.now() >= nextCleanup) {
    nextCleanup = Date.now() + 60_000;
    // Keep only today's private request history, never a permanent IP archive.
    await pool.query(`DELETE FROM scrapcook_recipe_usage WHERE usage_date < ${today}`);
    await pool.query(`DELETE FROM scrapcook_admin_attempts WHERE NOT EXISTS (
      SELECT 1 FROM unnest(request_times) AS t WHERE t > now() - interval '15 minutes'
    )`);
  }
}

export async function allowAdminSignIn(ip: string | undefined) {
  if (!ip || !process.env.SESSION_SECRET) return false;
  await ensureUsageStore();
  const hash = createHmac("sha256", process.env.SESSION_SECRET)
    .update(`scrapcook-admin-auth:${ip}`).digest("hex");
  const result = await pool.query(`
    INSERT INTO scrapcook_admin_attempts (client_hash, request_times)
    VALUES ($1, ARRAY[clock_timestamp()])
    ON CONFLICT (client_hash) DO UPDATE SET request_times = array_append(
      ARRAY(SELECT t FROM unnest(scrapcook_admin_attempts.request_times) AS t
        WHERE t > clock_timestamp() - interval '15 minutes'), clock_timestamp()
    )
    WHERE cardinality(ARRAY(SELECT t FROM unnest(scrapcook_admin_attempts.request_times) AS t
      WHERE t > clock_timestamp() - interval '15 minutes')) < 10
    RETURNING client_hash
  `, [hash]);
  return result.rows.length === 1;
}

export async function recordRecipeRequest(ip: string) {
  await ensureUsageStore();
  const recent = JSON.stringify([{ ip, timestamp: new Date().toISOString() }]);
  await pool.query(`
    INSERT INTO scrapcook_recipe_usage (usage_date, total_requests, recent_requests)
    VALUES (${today}, 1, $1::jsonb)
    ON CONFLICT (usage_date) DO UPDATE SET
      total_requests = scrapcook_recipe_usage.total_requests + 1,
      recent_requests = (
        SELECT jsonb_agg(value ORDER BY position)
        FROM jsonb_array_elements($1::jsonb || scrapcook_recipe_usage.recent_requests)
          WITH ORDINALITY AS entry(value, position)
        WHERE position <= 20
      )
  `, [recent]);
}

export async function recordProviderCall(provider: "spoon" | "gemini") {
  await ensureUsageStore();
  const column = provider === "spoon" ? "spoon" : "gemini";
  await pool.query(`
    INSERT INTO scrapcook_recipe_usage (usage_date, ${column})
    VALUES (${today}, 1)
    ON CONFLICT (usage_date) DO UPDATE
      SET ${column} = scrapcook_recipe_usage.${column} + 1
  `);
}

function displayLimit(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function getRecipeUsage() {
  await ensureUsageStore();
  const result = await pool.query<RecipeUsage>(`
    SELECT ${today}::text AS "usageDate",
      COALESCE(spoon, 0) AS spoon, COALESCE(gemini, 0) AS gemini,
      COALESCE(total_requests, 0) AS "totalRequests",
      COALESCE(recent_requests, '[]'::jsonb) AS "recentRequests"
    FROM (SELECT 1) AS placeholder
    LEFT JOIN scrapcook_recipe_usage ON usage_date = ${today}
  `);
  const row = result.rows[0];
  return {
    date: row.usageDate,
    spoon: row.spoon,
    gemini: row.gemini,
    totalRequests: row.totalRequests,
    recentRequests: row.recentRequests,
    limits: {
      spoon: displayLimit(process.env.SPOONACULAR_USAGE_LIMIT, 150),
      gemini: displayLimit(process.env.GEMINI_USAGE_LIMIT, 60),
    },
  };
}

export async function resetRecipeUsage() {
  await ensureUsageStore();
  await pool.query(`
    INSERT INTO scrapcook_recipe_usage (usage_date) VALUES (${today})
    ON CONFLICT (usage_date) DO UPDATE
      SET spoon = 0, gemini = 0, total_requests = 0, recent_requests = '[]'::jsonb
  `);
  return getRecipeUsage();
}
