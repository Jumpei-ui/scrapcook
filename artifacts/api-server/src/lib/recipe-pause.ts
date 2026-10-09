import { pool } from "@workspace/db";
import { ensureUsageStore } from "./recipe-usage";

export const SPOON_LIMIT = 150;
const today = "(statement_timestamp() AT TIME ZONE 'UTC')::date";
let ready: Promise<unknown> | undefined;

async function ensureBudget() {
  await ensureUsageStore();
  ready ??= pool.query(`
    CREATE TABLE IF NOT EXISTS scrapcook_provider_budget (
      usage_date date PRIMARY KEY,
      spoon_calls integer NOT NULL DEFAULT 0,
      paused_at timestamptz,
      force_resumed boolean NOT NULL DEFAULT false
    )
  `).catch((error: unknown) => { ready = undefined; throw error; });
  await ready;
  // Seed an existing day's calls once. Reporting resets never replenish this ledger.
  await pool.query(`
    INSERT INTO scrapcook_provider_budget (usage_date, spoon_calls, paused_at)
    SELECT ${today}, COALESCE(spoon, 0),
      CASE WHEN COALESCE(spoon, 0) >= ${SPOON_LIMIT} THEN clock_timestamp() END
    FROM (SELECT 1) AS placeholder
    LEFT JOIN scrapcook_recipe_usage ON usage_date = ${today}
    ON CONFLICT (usage_date) DO NOTHING
  `);
}

export async function getRecipePauseState() {
  await ensureBudget();
  const result = await pool.query<{
    spoon_calls: number; paused_at: Date | null; force_resumed: boolean; resumes_at: Date;
  }>(`
    SELECT spoon_calls, paused_at, force_resumed,
      ((usage_date + 1)::timestamp AT TIME ZONE 'UTC') AS resumes_at
    FROM scrapcook_provider_budget WHERE usage_date = ${today}
  `);
  const row = result.rows[0];
  if (!row) throw new Error("Provider budget unavailable.");
  return {
    paused: row.spoon_calls >= SPOON_LIMIT && !row.force_resumed,
    message: "Daily limit reached. Come back tomorrow!",
    resetTime: "midnight UTC",
    resumesAt: row.resumes_at.toISOString(),
    pausedAt: row.paused_at?.toISOString() ?? null,
    forceResumed: row.force_resumed,
    spoonCalls: row.spoon_calls,
    spoonLimit: SPOON_LIMIT,
  };
}

export function publicRecipePause(state: Awaited<ReturnType<typeof getRecipePauseState>>) {
  return {
    paused: state.paused, message: state.message,
    resetTime: state.resetTime, resumesAt: state.resumesAt,
  };
}

// Reserve immediately before EVERY paid Spoonacular call, not just once per recipe.
// PostgreSQL row locking prevents concurrent generations from crossing the ceiling.
export async function reserveProviderAllowance(provider: "spoon" | "gemini") {
  await ensureBudget();
  if (provider === "gemini") return !(await getRecipePauseState()).paused;
  const result = await pool.query(`
    UPDATE scrapcook_provider_budget
    SET spoon_calls = spoon_calls + 1,
      paused_at = CASE WHEN spoon_calls + 1 >= $1
        THEN COALESCE(paused_at, clock_timestamp()) ELSE paused_at END
    WHERE usage_date = ${today} AND (spoon_calls < $1 OR force_resumed)
    RETURNING spoon_calls
  `, [SPOON_LIMIT]);
  return result.rows.length === 1;
}

export async function forceResumeRecipes() {
  await ensureBudget();
  await pool.query(`
    UPDATE scrapcook_provider_budget SET force_resumed = true
    WHERE usage_date = ${today} AND spoon_calls >= $1
  `, [SPOON_LIMIT]);
  return getRecipePauseState();
}
