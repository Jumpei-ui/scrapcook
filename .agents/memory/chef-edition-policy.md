---
name: Chef's Edition ownership and limits
description: Verified purchase identity, public free access, and the meaning of unlimited paid usage.
---
Require verified email sign-in for checkout, restoring a purchase, and managing billing. Free recipe use remains available without an account.

**Why:** The user selected verified email sign-in rather than browser-only purchase restoration. A typed email or browser-stored email is not proof of purchase ownership.

**How to apply:** Bind purchases to the trusted signed-in identity. Never grant paid access using a query email, X-Pro-Email, or localStorage. Keep free visitors out of mandatory sign-in.

“Unlimited” removes personal daily recipe quotas, not shared spending safeguards or anti-abuse protections.

**Why:** The subscription brief explicitly preserves the existing shared Spoonacular cap, and the user previously required automatic pauses to protect spending.

**How to apply:** Disclose shared limits in the offer and checkout. Do not give paid users a provider-budget bypass. Keep paid access through the paid period when cancellation is scheduled for its end.

Keep the existing personal-provider-key bypass independent of subscription status.

**Why:** Earlier requirements allowed personal keys to continue cooking while shared credits are paused; users spending their own provider credits should not need a subscription to bypass the new shared-key free allowance.

**How to apply:** Validate and actually use personal keys; never treat a client flag claiming ownership as a bypass.
