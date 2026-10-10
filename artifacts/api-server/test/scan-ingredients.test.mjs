import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import test from "node:test";
import express from "express";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const dbRequire = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const { Pool } = dbRequire("pg");

test("vision scans use private credentials, shared atomic limits and validated review results", async t => {
  const schema = `scan_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
  const previous = { secret: process.env.SESSION_SECRET, key: process.env.GEMINI_API_KEY, legacyKey: process.env.GEMINI_KEY };
  const originalFetch = globalThis.fetch;
  let failStorage = false, failProvider = false, output = {
    items: [
      { name: " MILK ", confidence: "high", location: "top shelf" },
      { name: "milk", confidence: "medium", location: "door" },
      { name: "eggs", confidence: "high", location: "door" },
    ], imageQuality: "clear",
  };
  const calls = [];
  const servers = [];
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    process.env.SESSION_SECRET = "scan-test-only-secret";
    process.env.GEMINI_API_KEY = "scan-fixture-only-key";
    globalThis.__scanPool = { query: (...args) => failStorage
      ? Promise.reject(new Error("fixture store unavailable")) : pool.query(...args) };
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith("https://generativelanguage.googleapis.com/")) return originalFetch(url, options);
      calls.push({ url, options });
      if (failProvider) return new Response("upstream fixture error", { status: 503 });
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(output) }] } }] });
    };
    const compiled = await build({
      stdin: { contents: 'export {default} from "./src/routes/scan-ingredients";', loader: "ts",
        resolveDir: new URL("..", import.meta.url).pathname },
      bundle: true, platform: "node", format: "esm", write: false, external: ["express"],
      plugins: [{ name: "fixture-db", setup(builder) {
        builder.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: "clerk", namespace: "fixture-clerk" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture-clerk" }, () => ({
          contents: "export const getAuth=()=>({userId:null}); export const clerkClient={users:{}};",
        }));
        builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "fixture" }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents: "export const pool = globalThis.__scanPool;",
        }));
      } }],
    });
    const code = compiled.outputFiles[0].text.replaceAll('"express"', JSON.stringify(pathToFileURL(require.resolve("express")).href));
    async function instance(n) {
      const module = await import(`data:text/javascript;base64,${Buffer.from(code + `\n//${n}`).toString("base64")}`);
      const app = express();
      app.set("trust proxy", 1);
      app.use(express.json({ limit: "2mb" }));
      app.use("/api", module.default);
      const server = app.listen(0, "127.0.0.1"); servers.push(server);
      await once(server, "listening");
      return `http://127.0.0.1:${server.address().port}`;
    }
    const origins = await Promise.all([instance(1), instance(2)]);
    const image = `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 0, 255, 217]).toString("base64")}`;
    async function post(body = { image, mode: "fridge" }, ip = "192.0.2.1", origin = origins[0]) {
      return originalFetch(`${origin}/api/scanIngredients`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
        body: JSON.stringify(body),
      });
    }
    await t.test("returns normalized review items, conservative confidence, and correct vision request", async () => {
      const response = await post();
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        items: [
          { name: "milk", confidence: "medium", location: "door" },
          { name: "eggs", confidence: "high", location: "door" },
        ], imageQuality: "clear",
      });
      assert.equal(response.headers.get("cache-control"), "no-store");
      const call = calls.at(-1), body = JSON.parse(call.options.body);
      assert.match(call.url, /gemini-3\.1-flash-lite:generateContent$/);
      assert.equal(new URL(call.url).searchParams.has("key"), false);
      assert.equal(call.options.headers["x-goog-api-key"], "scan-fixture-only-key");
      assert.match(body.contents[0].parts[0].text, /FRIDGE.*photo/s);
      assert.match(body.contents[0].parts[0].text, /perishables/);
      assert.match(body.contents[0].parts[0].text, /Confidence high if very clear, medium if blurry, low if guess/);
      assert.equal(body.generationConfig.responseJsonSchema.properties.items.maxItems, 15);
      assert.equal(body.contents[0].parts[1].inlineData.mimeType, "image/jpeg");
      const data = await pool.query("SELECT gemini FROM scrapcook_recipe_usage");
      assert.equal(data.rows[0].gemini, 1);
    });
    await t.test("fridge and pantry share exactly ten scans under concurrent replicas", async () => {
      const before = calls.length;
      const results = await Promise.all(Array.from({ length: 22 }, (_, n) =>
        post({ image, mode: n % 2 ? "pantry" : "fridge" }, "192.0.2.2", origins[n % 2])));
      assert.equal(results.filter(r => r.status === 200).length, 10);
      assert.equal(results.filter(r => r.status === 429).length, 12);
      assert.equal(calls.length - before, 10);
      assert.ok(calls.slice(before).some(c => JSON.parse(c.options.body).contents[0].parts[0].text.includes("shelf-stable")));
      assert.equal(results.find(r => r.status === 429).headers.get("RateLimit-Limit"), "10");
      const rows = await pool.query("SELECT client_hash FROM recipe_rate_limits");
      assert.ok(rows.rows.every(row => /^[a-f0-9]{64}$/.test(row.client_hash)));
    });
    await t.test("invalid input never dispatches; empty scans retain photo quality", async () => {
      const before = calls.length;
      for (const body of [{ image, mode: "oven" }, { image: "data:image/svg+xml;base64,QQ==", mode: "fridge" },
        { image: "data:image/jpeg;base64,QQ==", mode: "fridge" }, { mode: "pantry" }]) {
        assert.equal((await post(body)).status, 400);
      }
      assert.equal(calls.length, before);
      output = { items: [], imageQuality: "blurry" };
      assert.deepEqual(await (await post(undefined, "192.0.2.3")).json(), output);
    });
    await t.test("provider failures are counted once, not retried, and have sanitized errors", async () => {
      failProvider = true;
      const before = calls.length;
      const response = await post(undefined, "192.0.2.4");
      assert.equal(response.status, 502);
      assert.equal(calls.length, before + 1);
      assert.doesNotMatch(await response.text(), /fixture-only-key|upstream fixture error/);
      failProvider = false;
      output = { title: "not an ingredient array" };
      assert.equal((await post(undefined, "192.0.2.4")).status, 502);
    });
    await t.test("rejects invalid confidence and oversized item lists; defaults missing quality", async () => {
      output = { items: [{ name: "milk", confidence: "certain", location: "" }], imageQuality: "clear" };
      assert.equal((await post(undefined, "192.0.2.7")).status, 502);
      output = { items: Array.from({ length: 16 }, () => ({ name: "milk", confidence: "high", location: "" })), imageQuality: "clear" };
      assert.equal((await post(undefined, "192.0.2.7")).status, 502);
      output = ["milk"];
      assert.equal((await post(undefined, "192.0.2.7")).status, 502);
      output = { items: [{ name: "yogurt", confidence: "low", location: "bottom shelf" }] };
      const before = calls.length;
      const response = await post(undefined, "192.0.2.7");
      assert.equal(calls.length, before + 1);
      assert.deepEqual(await response.json(), { ...output, imageQuality: "clear" });
    });
    await t.test("store failures and shared pause stop scans before provider dispatch", async () => {
      const before = calls.length;
      failStorage = true;
      assert.equal((await post(undefined, "192.0.2.5")).status, 503);
      failStorage = false;
      await pool.query("UPDATE scrapcook_provider_budget SET spoon_calls=150");
      const paused = await post(undefined, "192.0.2.5");
      assert.equal(paused.status, 429);
      assert.equal((await paused.json()).paused, true);
      assert.equal(calls.length, before);
    });
    await t.test("the rolling hour expires across instances", async () => {
      await pool.query("UPDATE scrapcook_provider_budget SET spoon_calls=0");
      await pool.query("UPDATE recipe_rate_limits SET request_times=ARRAY[now()-interval '61 minutes'], updated_at=now()-interval '61 minutes'");
      output = { items: [{ name: "pasta", confidence: "high", location: "middle shelf" }], imageQuality: "clear" };
      assert.equal((await post({ image, mode: "pantry" }, "192.0.2.2", origins[1])).status, 200);
    });
    await t.test("existing GEMINI_KEY is supported; missing keys never dispatch", async () => {
      process.env.GEMINI_KEY = "legacy-scan-fixture-only";
      delete process.env.GEMINI_API_KEY;
      assert.equal((await post(undefined, "192.0.2.6")).status, 200);
      assert.equal(calls.at(-1).options.headers["x-goog-api-key"], "legacy-scan-fixture-only");
      delete process.env.GEMINI_KEY;
      const before = calls.length;
      assert.equal((await post(undefined, "192.0.2.6")).status, 503);
      assert.equal(calls.length, before);
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [env, value] of [["SESSION_SECRET", previous.secret], ["GEMINI_API_KEY", previous.key], ["GEMINI_KEY", previous.legacyKey]]) {
      if (value === undefined) delete process.env[env]; else process.env[env] = value;
    }
    delete globalThis.__scanPool;
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});
