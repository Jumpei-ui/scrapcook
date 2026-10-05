---
name: ScrapCook AI scope
description: Product boundary for generative AI in recipe discovery and cooking instructions.
---

Use AI only to rewrite retrieved recipe instructions in plain, student-friendly language. Search and match recipes through providers; apply diet and time filters to provider metadata; keep cost estimates as editable Australian grocery-price references. If AI is unavailable or fails, display the original steps with an honest notice.

**Why:** The user explicitly scoped AI to student instruction simplification and asked that the existing recipe and savings behavior remain intact.

**How to apply:** Keep other ScrapCook flows provider-backed or deterministic; do not generate recipe matches, ingredient data, or cost estimates with AI.