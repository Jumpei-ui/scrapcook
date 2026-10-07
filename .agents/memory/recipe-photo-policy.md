---
name: Recipe photo policy
description: User-requested photographic style and ingredient accuracy for recipe images.
---

Prefer Spoonacular's returned recipe photos instead of replacing them with AI-generated images.

If recipe image generation is introduced, use this prompt with the actual recipe title:

“Professional food photography of {recipe_name}. Top-down shot on a rustic wooden table with natural window light. Realistic, appetizing, no text, no watermark, no people. Styled with ingredients from the recipe around the plate. High detail, 8k, DSLR photo, shallow depth of field.”

Include the recipe's actual ingredient names, not invented ingredient props. For Gemini/Image Gen, end with: “Photorealistic, appetizing colors, steam visible, garnished, restaurant plating”.

Never include “cartoon”, “3d render”, “illustration”, “perfect”, or “unreal” in recipe image prompts.

**Why:** The user requested this photography style and explicitly required real recipe ingredients in image prompts.

**How to apply:** Apply this only to recipe image generation or fetching, not recipe instruction prompts or unrelated styling. Do not add an image-generation provider merely to implement a conditional prompt change.
