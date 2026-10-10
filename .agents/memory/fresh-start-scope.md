---
name: Fresh-start scope
description: What clicking ScrapCook's logo is allowed to clear.
---

The logo starts a new recipe search, not a factory reset of the app.

**Why:** The user requested clearing ingredients, drafts, and previous results. Resetting nutrition was optional; keeping settings avoids unexpectedly changing their preferences.

**How to apply:** Clear the persisted search as well as client drafts so reloads cannot restore old results. Preserve API keys, nutrition settings, cooking preferences, saved meals, and usage limits. Ordinary navigation links do not imply a reset.
