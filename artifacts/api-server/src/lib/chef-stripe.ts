import { runMigrations } from "stripe-replit-sync";
import { getUncachableStripeClient, getStripeSync } from "./stripe-client";
import { ensureChefStore, setChefPriceId } from "./chef-store";

export async function initializeChefBilling() {
  chefBillingStage = "database";
  if (!process.env.DATABASE_URL) throw new Error("Billing database unavailable.");
  await ensureChefStore();
  await runMigrations({ databaseUrl: process.env.DATABASE_URL });
  chefBillingStage = "Stripe connection";
  const sync = await getStripeSync();
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (!domain) throw new Error("Billing callback domain unavailable.");
  chefBillingStage = "webhook registration";
  await sync.findOrCreateManagedWebhook(`https://${domain}/api/webhook`);
  chefBillingStage = "subscription synchronization";
  await sync.syncBackfill({ object: "all" });
  chefBillingStage = "monthly plan";
  const stripe = await getUncachableStripeClient();
  let price;
  if (process.env.STRIPE_PRICE_ID) price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID);
  else {
    const products = await stripe.products.search({ query: "metadata['scrapcook_plan']:'chef' AND active:'true'" });
    const product = products.data[0] ?? await stripe.products.create({
      name: "ScrapCook Chef's Edition",
      description: "No personal daily recipe quota. Shared service safety caps and anti-abuse limits apply.",
      metadata: { scrapcook_plan: "chef" },
    }, { idempotencyKey: "scrapcook-chef-product" });
    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
    price = prices.data.find(p => p.currency === "usd" && p.unit_amount === 1000 &&
      p.recurring?.interval === "month" && p.recurring.interval_count === 1)
      ?? await stripe.prices.create({ product: product.id, currency: "usd", unit_amount: 1000,
        recurring: { interval: "month" }, metadata: { scrapcook_plan: "chef" } },
      { idempotencyKey: `scrapcook-chef-monthly-${product.id}` });
  }
  if (!price.active || price.currency !== "usd" || price.unit_amount !== 1000 ||
    price.recurring?.interval !== "month" || price.recurring.interval_count !== 1) {
    throw new Error("Chef's Edition must cost USD10 per month.");
  }
  await sync.syncSingleEntity(price.id);
  // A dedicated portal configuration avoids changing unrelated products in the Stripe account.
  chefBillingStage = "customer portal";
  const configurations = await stripe.billingPortal.configurations.list({ limit: 100, active: true });
  const configuration = configurations.data.find(c => c.metadata?.scrapcook_plan === "chef")
    ?? await stripe.billingPortal.configurations.create({
      business_profile: { headline: "Manage ScrapCook Chef's Edition" },
      features: { subscription_cancel: { enabled: true, mode: "at_period_end" },
        payment_method_update: { enabled: true }, invoice_history: { enabled: true } },
      metadata: { scrapcook_plan: "chef" },
    }, { idempotencyKey: "scrapcook-chef-portal" });
  portalConfiguration = configuration.id;
  setChefPriceId(price.id);
  chefBillingStage = "ready";
}
export let portalConfiguration = "";
export let chefBillingStage = "not started";
