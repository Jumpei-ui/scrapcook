import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";
import { ReplitConnectors } from "@replit/connectors-sdk";

export async function getUncachableStripeClient() {
  const connectors = new ReplitConnectors();
  // The marker is not an API key and is never sent. Replit owns authorization,
  // token refresh and credentials; Stripe's SDK only formats the API requests.
  return new Stripe("replit-connector", {
    maxNetworkRetries: 2,
    httpClient: Stripe.createFetchHttpClient(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname !== "api.stripe.com") throw new Error("Unexpected Stripe API host.");
      const headers = new Headers(init?.headers);
      headers.delete("authorization");
      return connectors.proxy("stripe", `${url.pathname}${url.search}`, {
        method: init?.method, headers: Object.fromEntries(headers.entries()), body: init?.body,
      });
    }),
  });
}

let cachedSync: Promise<StripeSync> | undefined;
export function getStripeSync() {
  cachedSync ??= createSync().catch((error: unknown) => { cachedSync = undefined; throw error; });
  return cachedSync;
}
async function createSync() {
  if (!process.env.DATABASE_URL) throw new Error("Billing database unavailable.");
  const stripe = await getUncachableStripeClient();
  const account = await stripe.accounts.retrieve(null);
  const sync = new StripeSync({
    poolConfig: { connectionString: process.env.DATABASE_URL },
    stripeSecretKey: `replit-connector:${account.id}`, stripeAccountId: account.id,
    revalidateObjectsViaStripeApi: ["subscription", "invoice", "customer"],
    logger: { info() {}, warn() {}, error() {} },
  });
  // Public transport injection. The sync library and root SDK use different
  // Stripe type versions, but the shared runtime API is identical.
  sync.stripe = stripe as unknown as typeof sync.stripe;
  return sync;
}
