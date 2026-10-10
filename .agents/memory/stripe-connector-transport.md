---
name: Stripe connector transport
description: This project's Stripe connection supports managed requests, not the older native secret-key lookup.
---
Use the connected Stripe integration's managed request transport. Do not assume the legacy connection settings expose a raw Stripe payment API key.

**Why:** The legacy credential template found no payment key, while the connector SDK successfully authenticated Stripe requests. Asking the owner for duplicate keys would bypass the already-working connection.

**How to apply:** Keep authorization and token refresh in the connector SDK. Use its server-side transport with Stripe tooling, and never send integration credentials to the frontend.
