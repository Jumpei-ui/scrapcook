import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import test from "node:test";
import express from "express";
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
  };
  let providerCalls = 0;
  let providerFailure = false;
  let failStorage = false;
  let failDaily = false;
  const servers = [];
  const upstream = createServer((_req, res) => {
    providerCalls++;
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
      entryPoints: [new URL("../src/routes/scrapcook.ts", import.meta.url).pathname],
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
    async function instance(id) {
      const { default: router } = await import(
        `data:text/javascript;base64,${Buffer.from(`${code}\n// instance ${id}`).toString("base64")}`
      );
      const app = express();
      app.set("trust proxy", 1);
      app.use(express.json());
      app.use((req, _res, next) => { req.log = { error() {} }; next(); });
      app.use("/api", router);
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
      assert.equal(blocked.headers.get("Recipe-Daily-Remaining"), "0");
      assert.equal(blocked.headers.get("Recipe-Daily-Limit"), "3");
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
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
