import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import test from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const dbRequire = createRequire(new URL("../../../lib/db/package.json", import.meta.url));
const { Pool } = dbRequire("pg");

// Exercises the real router and PostgreSQL queries in a disposable schema.
// The Python/provider boundary is a local stub: no paid APIs are contacted.
test("shared recipe limits", async (t) => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL is required for the integration test");
  const schema = `recipe_limit_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: `-c search_path=${schema} -c timezone=Australia/Sydney`,
  });
  const previous = {
    limit: process.env.RECIPE_DAILY_LIMIT,
    secret: process.env.SESSION_SECRET,
    port: process.env.SCRAPCOOK_PY_PORT,
    password: process.env.ADMIN_PASSWORD,
  };
  let providerCalls = 0;
  let providerFailure = false;
  let failStorage = false;
  let failDaily = false;
  let lastProviderHeaders;
  const servers = [];
  const upstream = createServer((_req, res) => {
    providerCalls++;
    lastProviderHeaders = _req.headers;
    res.statusCode = providerFailure ? 502 : 200;
    res.setHeader("Content-Type", "application/json");
    res.end('{"recipes":[]}');
  });
  servers.push(upstream);
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    process.env.SCRAPCOOK_PY_PORT = String(upstream.address().port);
    process.env.SESSION_SECRET = "integration-test-only";
    process.env.ADMIN_PASSWORD = "integration-owner-fixture-only";
    process.env.RECIPE_DAILY_LIMIT = "3";
    globalThis.__recipeLimitTestPool = {
      query: (...args) => {
        if (failStorage || (failDaily && args[0].includes("WITH today"))) {
          return Promise.reject(new Error("simulated storage failure"));
        }
        return pool.query(...args);
      },
    };
    const compiled = await build({
      stdin: {
        contents: `export {default} from "./src/routes/scrapcook";
          export {default as adminRouter} from "./src/routes/admin";
          export * from "./src/lib/recipe-pause";`,
        resolveDir: new URL("..", import.meta.url).pathname, loader: "ts",
      },
      bundle: true, platform: "node", format: "esm", write: false,
      external: ["express"],
      plugins: [{
        name: "test-boundaries",
        setup(builder) {
          builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: "db", namespace: "test" }));
          builder.onResolve({ filter: /^\.\/savings$/ }, () => ({ path: "savings", namespace: "test" }));
          builder.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => ({
            contents: path === "db"
              ? "export const pool = globalThis.__recipeLimitTestPool;"
              : 'import { Router } from "express"; export default Router();',
          }));
        },
      }],
    });
    const code = compiled.outputFiles[0].text.replaceAll(
      '"express"', JSON.stringify(pathToFileURL(require.resolve("express")).href),
    );
    let budget;
    async function instance(id) {
      const module = await import(
        `data:text/javascript;base64,${Buffer.from(`${code}\n// instance ${id}`).toString("base64")}`
      );
      budget ??= module;
      const { default: router, adminRouter } = module;
      const app = express();
      app.set("trust proxy", 1);
      app.use(express.json());
      app.use(cookieParser(process.env.SESSION_SECRET));
      app.use((req, _res, next) => { req.log = { error() {} }; next(); });
      app.use("/api", router);
      app.use(adminRouter);
      const server = app.listen(0, "127.0.0.1");
      servers.push(server);
      await once(server, "listening");
      return `http://127.0.0.1:${server.address().port}`;
    }
    const first = await instance(1);
    let client = 0;
    const request = (base = first, path = "/api/recipes", ip = `198.51.100.${++client}`) =>
      fetch(`${base}${path}`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
        body: "{}",
      });
    // Initialize the isolated tables before concurrent requests.
    assert.equal((await request()).status, 200);
    const second = await instance(2);
    async function reset(limit = "3") {
      process.env.RECIPE_DAILY_LIMIT = limit;
      await pool.query("TRUNCATE recipe_daily_usage, recipe_rate_limits");
      providerCalls = 0;
    }

    await t.test("concurrent clients and replicas share exactly one allowance, including the alias", async () => {
      await reset();
      const replies = await Promise.all(Array.from({ length: 20 }, (_, i) =>
        request(i % 2 ? first : second, ["/api/recipes", "/api/getRecipes", "/api/scrapcook/recipes"][i % 3])));
      assert.equal(replies.filter((r) => r.status === 200).length, 3);
      assert.equal(replies.filter((r) => r.status === 429).length, 17);
      assert.equal(providerCalls, 3);
      assert.equal((await pool.query("SELECT used FROM recipe_daily_usage")).rows[0].used, 3);
      const blocked = replies.find((r) => r.status === 429);
      assert.equal(blocked.headers.get("Recipe-Daily-Remaining"), null);
      assert.equal(blocked.headers.get("Recipe-Daily-Limit"), null);
      const now = new Date();
      const seconds = Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000);
      assert.ok(Math.abs(Number(blocked.headers.get("Retry-After")) - seconds) <= 3);
      assert.match((await blocked.json()).error, /midnight UTC/);
      const restarted = await instance(3);
      assert.equal((await request(restarted)).status, 429);
      assert.equal(providerCalls, 3);
    });
    await t.test("a new UTC day ignores yesterday's exhausted bucket regardless of DB timezone", async () => {
      await reset();
      await pool.query(`
        INSERT INTO recipe_daily_usage VALUES
        ((statement_timestamp() AT TIME ZONE 'UTC')::date - 1, 3)
      `);
      assert.equal((await request()).status, 200);
      const rows = (await pool.query(`
        SELECT used FROM recipe_daily_usage
        WHERE usage_day = (statement_timestamp() AT TIME ZONE 'UTC')::date
      `)).rows;
      assert.equal(rows[0].used, 1);
    });
    await t.test("zero pauses generation without reserving or calling a provider", async () => {
      await reset("0");
      assert.equal((await request()).status, 429);
      assert.equal(providerCalls, 0);
      assert.equal((await pool.query("SELECT * FROM recipe_daily_usage")).rowCount, 0);
    });
    await t.test("failed provider attempts remain counted to avoid spending beyond the cap", async () => {
      await reset("1");
      providerFailure = true;
      assert.equal((await request()).status, 502);
      providerFailure = false;
      assert.equal((await request(second, "/api/scrapcook/recipes")).status, 429);
      assert.equal(providerCalls, 1);
      assert.equal((await pool.query("SELECT used FROM recipe_daily_usage")).rows[0].used, 1);
    });
    await t.test("missing and malformed configuration fail closed on both URLs", async () => {
      await reset();
      for (const value of [undefined, "", "-1", "1.5", "no-limit", "2147483648"]) {
        if (value === undefined) delete process.env.RECIPE_DAILY_LIMIT;
        else process.env.RECIPE_DAILY_LIMIT = value;
        assert.equal((await request()).status, 503);
        assert.equal((await request(first, "/api/scrapcook/recipes")).status, 503);
      }
      assert.equal(providerCalls, 0);
    });
    await t.test("unavailable initial or daily storage blocks provider calls", async () => {
      await reset();
      failStorage = true;
      assert.equal((await request()).status, 503);
      failStorage = false;
      failDaily = true;
      assert.equal((await request(first, "/api/scrapcook/recipes")).status, 503);
      failDaily = false;
      assert.equal(providerCalls, 0);
      assert.equal((await request()).status, 200);
    });
    await t.test("the existing 20-per-hour IP limit still blocks before daily reservation", async () => {
      await reset("100");
      for (let i = 0; i < 20; i++) assert.equal((await request(first, "/api/recipes", "203.0.113.1")).status, 200);
      const blocked = await request(second, "/api/scrapcook/recipes", "203.0.113.1");
      assert.equal(blocked.status, 429);
      assert.match((await blocked.json()).error, /20 requests per hour/);
      assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
      assert.equal(providerCalls, 20);
      assert.equal((await pool.query("SELECT used FROM recipe_daily_usage")).rows[0].used, 20);
    });
    await t.test("atomic provider reservations stop exactly at150 across replicas", async () => {
      await pool.query("UPDATE scrapcook_provider_budget SET spoon_calls=149, paused_at=NULL, force_resumed=false");
      const allowed = await Promise.all(Array.from({ length: 30 }, () => budget.reserveProviderAllowance("spoon")));
      assert.equal(allowed.filter(Boolean).length, 1);
      const state = await budget.getRecipePauseState();
      assert.equal(state.spoonCalls, 150);
      assert.equal(state.paused, true);
      assert.ok(state.pausedAt);
      assert.equal(await budget.reserveProviderAllowance("gemini"), false);
    });
    await t.test("pause is checked before every generation alias and public status hides counts", async () => {
      await reset();
      for (const path of ["/api/recipes", "/api/getRecipes", "/api/scrapcook/recipes"]) {
        const response = await request(first, path);
        assert.equal(response.status, 429);
        const data = await response.json();
        assert.equal(data.paused, true);
        assert.equal(data.message, "Daily limit reached. Come back tomorrow!");
        assert.equal(data.resetTime, "midnight UTC");
        assert.ok(Date.parse(data.resumesAt) > Date.now());
        assert.equal(data.spoonCalls, undefined);
      }
      const status = await (await fetch(first + "/api/recipes/status")).json();
      assert.equal(status.paused, true);
      assert.equal(status.spoonCalls, undefined);
      assert.equal(providerCalls, 0);
      assert.equal((await pool.query("SELECT * FROM recipe_daily_usage")).rowCount, 0);
    });
    await t.test("BYOK uses supplied keys only, bypasses owner caps, and rejects flags/malformed keys", async () => {
      await reset("0");
      const response = await fetch(first + "/api/getRecipes", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "192.0.2.40" },
        body: JSON.stringify({ userSpoonKey: "personal-fixture-only" }),
      });
      assert.equal(response.status, 200);
      assert.equal(lastProviderHeaders["x-personal-spoon-key"], "personal-fixture-only");
      assert.equal(lastProviderHeaders["x-personal-gemini-key"], "");
      assert.equal(providerCalls, 1);
      assert.equal((await pool.query("SELECT * FROM recipe_daily_usage")).rowCount, 0);
      for (const userSpoonKey of [true, "bad\nkey", ""]) {
        const invalid = await fetch(first + "/api/getRecipes", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userSpoonKey }),
        });
        assert.equal(invalid.status, 400);
      }
      assert.equal((await request()).status, 429);
      assert.equal(providerCalls, 1);
    });
    await t.test("owner reset cannot unpause; resume requires auth, CSRF and charge acceptance", async () => {
      const login = await fetch(first + "/api/admin/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "integration-owner-fixture-only" }),
      });
      assert.equal(login.status, 204);
      const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
      const html = await (await fetch(first + "/admin", { headers: { Cookie: cookie } })).text();
      const csrf = JSON.parse(html.match(/const csrfToken=(".*?");/)[1]);
      const headers = { Cookie: cookie, "Content-Type": "application/json", "X-Admin-CSRF": csrf };
      const resetResponse = await fetch(first + "/api/admin/reset", { method: "POST", headers });
      assert.equal(resetResponse.status, 200);
      assert.equal((await resetResponse.json()).pause.paused, true);
      assert.equal((await fetch(first + "/api/admin/resume", { method: "POST" })).status, 404);
      assert.equal((await fetch(first + "/api/admin/resume", { method: "POST", headers: { Cookie: cookie } })).status, 404);
      assert.equal((await fetch(first + "/api/admin/resume", { method: "POST", headers, body: "{}" })).status, 400);
      const resumed = await fetch(first + "/api/admin/resume", {
        method: "POST", headers, body: JSON.stringify({ acceptCharges: true }),
      });
      assert.equal(resumed.status, 200);
      assert.equal((await resumed.json()).pause.paused, false);
      assert.equal(await budget.reserveProviderAllowance("spoon"), true);
    });
    await t.test("UTC rollover removes pause and force-resume even under a non-UTC DB timezone", async () => {
      await pool.query(`UPDATE scrapcook_provider_budget SET usage_date =
        (statement_timestamp() AT TIME ZONE 'UTC')::date - 1`);
      const state = await budget.getRecipePauseState();
      assert.equal(state.spoonCalls, 0);
      assert.equal(state.paused, false);
      assert.equal(state.forceResumed, false);
      // A stale resume click after midnight must not disable the new day's ceiling.
      assert.equal((await budget.forceResumeRecipes()).forceResumed, false);
    });
  } finally {
    for (const server of servers) await new Promise((resolve) => server.close(resolve));
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    delete globalThis.__recipeLimitTestPool;
    for (const [key, value] of Object.entries({
      RECIPE_DAILY_LIMIT: previous.limit,
      SESSION_SECRET: previous.secret,
      SCRAPCOOK_PY_PORT: previous.port,
      ADMIN_PASSWORD: previous.password,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
