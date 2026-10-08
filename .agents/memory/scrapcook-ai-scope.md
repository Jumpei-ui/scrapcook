---
name: ScrapCook AI scope
description: Product boundary for generative AI in recipe discovery and cooking instructions.
---

Use Spoonacular for recipe discovery when the user supplies its key. Gemini may expand returned recipes with measurements, temperatures, timings, and beginner tips, or generate recipes from the pantry when only a Gemini key is supplied. Without either key, direct the user to Settings rather than silently using demo recipes. Keep grocery estimates as editable Australian reference values, outside AI.

**Why:** The user revised the earlier instruction-only AI boundary to a hybrid recipe flow with a Gemini-only fallback, while explicitly prohibiting an app rebuild or restyling.

**How to apply:** Keep AI changes within recipe generation and detailed cooking steps; leave dashboard, pantry, authentication, and estimate behavior alone. If Gemini enhancement fails, retain source instructions with an honest notice.

Use the user's provider keys for this flow, not a silently substituted Replit-managed AI integration. Browser-local key persistence was explicitly requested, but must not be described as a secure vault.

**Why:** The user requested key inputs saved in localStorage and also asked that credentials never be logged.

**How to apply:** Never log credentials or provider errors that can contain them. Replacing browser-local persistence with safer server-side storage is a separate change requiring the user's approval.

Snack Mode is an opt-in addition to the existing finder, not a separate page or app. Meals remains the default; Gemini snacks should be simple pantry-only options requiring no cooking skills.

**Why:** The user explicitly requested minimal changes, no new pages, and a simple snack alternative while keeping everything else the same.

**How to apply:** Keep Snack Mode work within the existing finder and recipe-generation service; preserve the Meals flow and unrelated pages.

Nutrition per serving should use provider-supplied data, not invented nutritional values.

**Why:** The user requested Spoonacular nutrients and an explicit “Nutrition info unavailable” fallback when nutrition is missing.

**How to apply:** Keep missing nutrition unavailable, including Gemini-only recipes, unless the user separately requests a nutrition-estimation feature.

Turning nutrition off must skip provider nutrition enrichment, not merely hide it.

**Why:** The user explicitly wants the nutrition toggle to save API credits.

**How to apply:** Apply the saved choice to discovery details, recipe detail fallbacks, and session restoration. Keep nutrition-on and nutrition-off cache entries separate.