---
name: ScrapCook AI scope
description: Product boundary for generative AI in recipe discovery and cooking instructions.
---

Use Spoonacular for recipe discovery when the app owner configures its server key. Gemini may expand returned recipes with measurements, temperatures, timings, and beginner tips, or generate recipes from the pantry when only Gemini is configured. Without either key, report that the recipe service is not configured rather than silently using demo recipes. Keep grocery estimates as editable Australian reference values, outside AI.

**Why:** The user revised the earlier instruction-only AI boundary to a hybrid recipe flow with a Gemini-only fallback, while explicitly prohibiting an app rebuild or restyling.

**How to apply:** Keep recipe AI changes within generation and detailed cooking steps; leave dashboard, authentication, and estimate behavior alone. Fridge/Pantry photo identification is now an explicit, opt-in addition to the ingredient selector, not an overhaul of pantry management. If Gemini enhancement fails, retain source instructions with an honest notice.

Process scan photos transiently; keep ingredient names, not uploaded photo archives.

**Why:** Scanning only needs the identified ingredients. Persisting private fridge/pantry images would add unnecessary privacy exposure and storage cost.

**How to apply:** Disclose that identification sends the selected photo to Gemini. Do not log, persist or cache photo payloads. Preserve the existing editable ingredient chips so users can correct uncertain AI detections.

Use a low-cost multimodal Flash-Lite model for vision scanning independently of the recipe-generation model.

**Why:** The requested Gemini 1.5 Flash was retired. A supported inexpensive vision model preserves the cost goal without changing existing recipe generation.

**How to apply:** Check Google's current model availability before changing scan models and explain deprecation-driven substitutions. Do not silently move to a different provider or a more expensive model.

Keep shared owner provider keys in server Secrets. Opt-in personal-key overrides are allowed to continue cooking during a shared-key pause.

**Why:** The user secured shared keys on the backend, then explicitly requested personal browser-stored keys as a pause bypass.

**How to apply:** Never send shared keys to browsers. Personal requests must actually use supplied personal keys, never fall back to a shared Gemini key or unlock shared funds using a client flag. Keep personal credentials out of logs, backend persistence, and responses; warn that localStorage is not encrypted. Do not silently replace the user's providers with a Replit-managed AI integration.

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