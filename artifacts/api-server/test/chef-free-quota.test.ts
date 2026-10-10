import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { pool } from "@workspace/db";
import { clientHash, ensureChefStore, freeRecipeQuota, freeRemaining, nextUtcMidnight } from "../src/lib/chef-store";

const request = { ip: `192.0.2.1:${randomUUID()}` } as Request;
const hash = clientHash(request);
async function attempt(locals: Record<string, unknown> = {}) {
  let accepted = false;
  let code = 200;
  let body: Record<string, unknown> = {};
  const response = {
    locals, status(value: number) { code = value; return this; },
    json(value: Record<string, unknown>) { body = value; return this; },
  } as unknown as Response;
  await freeRecipeQuota(request, response, () => { accepted = true; });
  return { accepted, code, body };
}
try {
  await ensureChefStore();
  // A prior day's exhausted allowance must not block the current UTC day.
  await pool.query(`INSERT INTO chef_free_usage VALUES($1,(now() AT TIME ZONE 'UTC')::date - 1,3)`, [hash]);
  assert.equal(await freeRemaining(request), 3);
  const results = await Promise.all(Array.from({ length: 12 }, () => attempt()));
  assert.equal(results.filter(r => r.accepted).length, 3, "Concurrent requests cannot exceed three free attempts");
  assert.equal(results.filter(r => r.code === 429 && r.body.freeLimit === true).length, 9);
  assert.equal(await freeRemaining(request), 0);
  assert.equal((await attempt()).code, 429, "The allowance survives separate middleware invocations");
  assert.equal((await attempt({ chefPro: true })).accepted, true, "Verified Pro skips the personal allowance");
  assert.equal((await attempt({ personalProviderKeys: { spoonacular: "test-fixture" } })).accepted, true,
    "Personal-key use preserves the existing owner-budget bypass");
  assert.equal(await freeRemaining(request), 0, "Bypasses must not reset free allowance");
  const reset = new Date(nextUtcMidnight());
  assert.equal(reset.getUTCHours(), 0);
  assert.ok(reset.getTime() > Date.now());
  console.log("Chef quota: concurrent cap, persistent allowance, UTC reset and trusted bypass checks passed.");
} finally {
  await pool.query("DELETE FROM chef_free_usage WHERE client_hash=$1", [hash]);
  await pool.end();
}
