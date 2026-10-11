import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import express from "express";
import Stripe from "stripe";
const require = createRequire(import.meta.url);

test("Chef customer ownership and signed subscription lifecycle", async () => {
  const fixtureSigner = new Stripe("fixture-only-not-a-payment-key");
  const secret = "fixture-signing-value";
  const customers = { alice: "cus_alice", bob: "cus_bob" };
  let canonicalStatus = "active";
  let storedStatus = "active";
  let verifiedEmail = true;
  let syncCalls = 0;
  let portalCustomer;
  let checkout;
  let openSessions = [];
  const expiredSessions = [];
  let trialEnd = Math.floor(Date.now() / 1000) + 7 * 86400;
  let cancelScheduled = false;
  // Exercise the real entitlement SQL against inline fixtures, without writing
  // Stripe-owned tables or making provider/payment requests.
  const { Pool } = createRequire(new URL("../../../lib/db/package.json", import.meta.url))("pg");
  const fixtureDb = new Pool({ connectionString: process.env.DATABASE_URL });
  const receipt = {
    id: "cs_fixture_receipt123", client_reference_id: "alice", customer: customers.alice,
    metadata: { scrapcook_plan: "chef" }, status: "complete", payment_status: "paid", subscription: "sub_fixture",
  };
  globalThis.__chefFixture = {
    pool: {
      async query(sql, params) {
        if (sql.includes("SELECT customer_id")) return { rows: [{ customer_id: customers[params[0]] }] };
        if (sql.includes("FROM stripe.subscriptions")) {
          const raw = { customer: customers.alice, status: storedStatus,
            metadata: { userId: "alice" }, trial_end: trialEnd, cancel_at_period_end: cancelScheduled,
            items: { data: [{ price: { id: "price_fixture" }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] } };
          return fixtureDb.query(sql.replace("FROM stripe.subscriptions s JOIN chef_customers c",
            "FROM (SELECT $3::jsonb AS _raw_data) s JOIN (SELECT $1::text AS user_id, $4::text AS customer_id) c"),
            [...params, JSON.stringify(raw), customers[params[0]]]);
        }
        if (sql.includes("SELECT used")) return { rows: [] };
        return { rows: [] };
      },
    },
    auth(req) { return { userId: req.get("x-fixture-user") ?? null }; },
    clerk: { users: { async getUser(id) { return { primaryEmailAddressId: "email",
      emailAddresses: [{ id: "email", emailAddress: `${id}@example.invalid`,
        verification: { status: verifiedEmail ? "verified" : "unverified" } }] }; } } },
    stripe: {
      checkout: { sessions: {
        async retrieve() { return receipt; },
        async list(params) { return { data: params.status === "open" ? openSessions : [] }; },
        async expire(id) { expiredSessions.push(id); },
        async create(params) { checkout = params; return { url: "https://checkout.stripe.com/fixture" }; },
      } },
      subscriptions: { async list() { return { data: [] }; } },
      billingPortal: { sessions: { async create(params) {
        portalCustomer = params.customer; return { url: "https://billing.stripe.com/fixture" };
      } } },
    },
    sync: {
      async processWebhook(payload, signature) { fixtureSigner.webhooks.constructEvent(payload, signature, secret); },
      async syncSingleEntity() { syncCalls++; storedStatus = canonicalStatus; },
    },
  };
  const previousDomains = process.env.APP_PUBLIC_DOMAINS;
  process.env.APP_PUBLIC_DOMAINS = "fixture.example.invalid";
  const compiled = await build({
    stdin: { contents: 'export {default,chefWebhook} from "./src/routes/chef-billing"; export {setChefPriceId,chefIdentity} from "./src/lib/chef-store";',
      loader: "ts", resolveDir: new URL("..", import.meta.url).pathname },
    bundle: true, platform: "node", format: "esm", write: false, external: ["express"],
    plugins: [{ name: "billing-fixtures", setup(builder) {
      builder.onResolve({ filter: /^@workspace\/db$|^@clerk\/express$|\/stripe-client$|\/chef-stripe$/ },
        ({ path }) => ({ path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
        contents: path === "@workspace/db" ? "export const pool=globalThis.__chefFixture.pool;"
          : path === "@clerk/express" ? "export const getAuth=globalThis.__chefFixture.auth; export const clerkClient=globalThis.__chefFixture.clerk;"
          : path.endsWith("chef-stripe") ? "export const portalConfiguration='fixture';"
          : "export const getUncachableStripeClient=async()=>globalThis.__chefFixture.stripe; export const getStripeSync=async()=>globalThis.__chefFixture.sync;",
      }));
    } }],
  });
  const code = compiled.outputFiles[0].text.replaceAll('"express"', JSON.stringify(pathToFileURL(require.resolve("express")).href));
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  module.setChefPriceId("price_fixture");
  const app = express();
  app.post("/api/webhook", express.raw({ type: "application/json" }), module.chefWebhook);
  app.use(express.json()); app.use("/api", module.default);
  app.get("/identity", module.chefIdentity, (_req, res) => res.json({ isPro: res.locals.chefPro }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(path, user, method = "GET", body, extra = {}) {
    return fetch(origin + path, { method, headers: { "Content-Type": "application/json",
      "X-Forwarded-Host": "fixture.example.invalid", ...(user ? { "X-Fixture-User": user } : {}), ...extra },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  }
  try {
    assert.equal((await request("/api/create-checkout", null, "POST")).status, 401);
    assert.equal((await request("/api/customer-portal", null, "POST")).status, 401);
    assert.equal((await request("/api/subscription-status?email=alice@example.invalid", null)).status, 401);
    assert.equal((await (await request("/identity", null, "GET", undefined, { "X-Pro-Email": "alice@example.invalid" })).json()).isPro, false);
    assert.equal((await request("/api/subscription-status?email=bob@example.invalid", "alice")).status, 403);
    assert.equal((await request("/api/subscription-status?session_id=cs_fixture_receipt123", "bob")).status, 404);
    assert.equal(syncCalls, 0, "Another customer cannot reconcile or claim this receipt");
    receipt.payment_status = "unpaid";
    assert.equal((await request("/api/subscription-status?session_id=cs_fixture_receipt123", "alice")).status, 409);
    assert.equal(syncCalls, 0, "Unpaid checkout must never activate access");
    receipt.payment_status = "paid";
    assert.equal((await (await request("/api/subscription-status?session_id=cs_fixture_receipt123", "alice")).json()).isPro, true);
    assert.equal((await request("/api/customer-portal", "alice", "POST", { customer: "cus_bob" })).status, 200);
    assert.equal(portalCustomer, "cus_alice", "Ignore customer IDs supplied by clients");
    verifiedEmail = false;
    assert.equal((await request("/api/create-checkout", "bob", "POST")).status, 401);
    verifiedEmail = true;
    assert.equal((await request("/api/create-checkout", "bob", "POST", { isPro: true, email: "alice@example.invalid" })).status, 200);
    assert.equal(checkout.customer, "cus_bob");
    assert.equal(checkout.client_reference_id, "bob");
    assert.equal(checkout.line_items[0].price, "price_fixture");
    assert.equal(checkout.mode, "subscription");
    assert.equal(checkout.subscription_data.trial_period_days, 7);
    assert.equal(checkout.subscription_data.trial_settings.end_behavior.missing_payment_method, "cancel");
    assert.equal(checkout.payment_method_collection, "always");
    assert.equal(checkout.subscription_data.metadata.userId, "bob");
    assert.equal(checkout.metadata.trial_days, "7");
    openSessions = [{ id: "cs_old", metadata: { scrapcook_plan: "chef" }, client_reference_id: "bob",
      url: "https://checkout.stripe.com/old" }];
    await request("/api/create-checkout", "bob", "POST");
    assert.deepEqual(expiredSessions, ["cs_old"], "Retire checkout links that would charge immediately");
    openSessions = [{ id: "cs_trial", metadata: { scrapcook_plan: "chef", trial_days: "7" },
      client_reference_id: "bob", payment_method_collection: "always", url: "https://checkout.stripe.com/trial" }];
    assert.equal((await (await request("/api/create-checkout", "bob", "POST")).json()).url,
      "https://checkout.stripe.com/trial", "Reuse the current trial offer");
    openSessions = [];

    canonicalStatus = "trialing";
    receipt.payment_status = "no_payment_required";
    const trial = await (await request("/api/subscription-status?session_id=cs_fixture_receipt123", "alice")).json();
    assert.equal(trial.isPro, true, "Completed zero-charge trial checkout grants Pro");
    assert.equal(trial.isTrial, true);
    assert.equal(trial.trialDaysLeft, 7);
    assert.equal(trial.trialEnds, trialEnd * 1000);
    assert.ok(trial.willBeChargedOn);
    cancelScheduled = true;
    const cancelling = await (await request("/api/subscription-status", "alice")).json();
    assert.equal(cancelling.isPro, true, "Trial access lasts until its end when cancellation is scheduled");
    assert.equal(cancelling.willBeChargedOn, null, "Cancelled trial must not promise an automatic charge");
    cancelScheduled = false;
    trialEnd = Math.floor(Date.now() / 1000) - 1;
    assert.equal((await (await request("/api/subscription-status", "alice")).json()).isPro, false,
      "Expired trial cannot grant access while awaiting a webhook");
    trialEnd = Math.floor(Date.now() / 1000) + 7 * 86400;
    const signedEvent = async (event) => {
      const payload = JSON.stringify(event);
      return request("/api/webhook", null, "POST", event,
        { "Stripe-Signature": fixtureSigner.webhooks.generateTestHeaderString({ payload, secret }) });
    };
    assert.equal((await signedEvent({ type: "customer.subscription.trial_will_end",
      data: { object: { id: "sub_fixture" } } })).status, 200);
    assert.equal((await (await request("/api/subscription-status", "alice")).json()).isTrial, true,
      "Reminder event does not end a trial");
    canonicalStatus = "active";
    assert.equal((await signedEvent({ type: "invoice.paid", data: { object: {
      parent: { subscription_details: { subscription: "sub_fixture" } },
    } } })).status, 200);
    const paid = await (await request("/api/subscription-status", "alice")).json();
    assert.equal(paid.isPro, true);
    assert.equal(paid.isTrial, false);
    assert.equal(paid.trialDaysLeft, 0);
    assert.equal(paid.trialEnds, null);
    const payload = JSON.stringify({ type: "customer.subscription.deleted", data: { object: { id: "sub_fixture" } } });
    assert.equal((await request("/api/webhook", null, "POST", JSON.parse(payload), { "Stripe-Signature": "forged" })).status, 400);
    assert.equal(storedStatus, "active", "Forged cancellation cannot mutate subscription state");
    canonicalStatus = "canceled";
    const signature = fixtureSigner.webhooks.generateTestHeaderString({ payload, secret });
    assert.equal((await request("/api/webhook", null, "POST", JSON.parse(payload), { "Stripe-Signature": signature })).status, 200);
    assert.equal((await (await request("/identity", "alice")).json()).isPro, false);
    // An old valid event cannot revive a subscription: always reread canonical Stripe state.
    assert.equal((await request("/api/webhook", null, "POST", JSON.parse(payload), { "Stripe-Signature": signature })).status, 200);
    assert.equal(storedStatus, "canceled");
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previousDomains === undefined) delete process.env.APP_PUBLIC_DOMAINS;
    else process.env.APP_PUBLIC_DOMAINS = previousDomains;
    delete globalThis.__chefFixture;
    await fixtureDb.end();
  }
});
