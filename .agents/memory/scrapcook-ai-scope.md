---
name: ScrapCook AI scope
description: Product boundary for generative AI in recipe discovery and cooking instructions.
---

Use Spoonacular for recipe discovery when the app owner configures its server key. Gemini may expand returned recipes with measurements, temperatures, timings, and beginner tips, or generate recipes from the pantry when only Gemini is configured. Without either key, report that the recipe service is not configured rather than silently using demo recipes. Keep grocery estimates as editable Australian reference values, outside AI.

**Why:** The user revised the earlier instruction-only AI boundary to a hybrid recipe flow with a Gemini-only fallback, while explicitly prohibiting an app rebuild or restyling.

**How to apply:** Keep AI changes within recipe generation and detailed cooking steps; leave dashboard, pantry, authentication, and estimate behavior alone. If Gemini enhancement fails, retain source instructions with an honest notice.

Use the app owner's provider keys in server Secrets, not browser-supplied credentials or a silently substituted Replit-managed AI integration.

**Why:** The user explicitly replaced the earlier localStorage approach with server-only secrets before public launch.

**How to apply:** Do not reintroduce browser key fields, persistence, or overrides. Never log credentials or provider errors that can contain them, and never include keys in client responses.

Rate limits on owner-funded generation must survive restarts, be shared across app instances, and fail closed when their store is unavailable.

**Why:** The user wants to prevent public recipe requests from draining credits. Process-local counters reset on restarts and multiply the allowance across replicas.

**How to apply:** Keep the shared, atomic limit rather than substituting an in-memory counter. Protect legacy aliases as well as the main generation endpoint; keep stored IP identities opaque.

Snack Mode is an opt-in addition to the existing finder, not a separate page or app. Meals remains the default; Gemini snacks should be simple pantry-only options requiring no cooking skills.

**Why:** The user explicitly requested minimal changes, no new pages, and a simple snack alternative while keeping everything else the same.

**How to apply:** Keep Snack Mode work within the existing finder and recipe-generation service; preserve the Meals flow and unrelated pages.

Nutrition per serving should use provider-supplied data, not invented nutritional values.

**Why:** The user requested Spoonacular nutrients and an explicit “Nutrition info unavailable” fallback when nutrition is missing.

**How to apply:** Keep missing nutrition unavailable, including Gemini-only recipes, unless the user separately requests a nutrition-estimation feature.

Turning nutrition off must skip provider nutrition enrichment, not merely hide it.

**Why:** The user explicitly wants the nutrition toggle to save API credits.

**How to apply:** Apply the saved choice to discovery details, recipe detail fallbacks, and session restoration. Keep nutrition-on and nutrition-off cache entries separate.