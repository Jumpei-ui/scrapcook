import html
import hashlib
import json
import math
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from flask import Flask, jsonify, request, session
from werkzeug.middleware.proxy_fix import ProxyFix


app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET") or os.urandom(32)
app.config.update(
    SESSION_COOKIE_NAME="scrapcook_session",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_PATH="/api/scrapcook",
    PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 7,
)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

EXPERIENCES = {"beginner", "intermediate", "pro"}
TIME_OPTIONS = {"under15", "15to30", "30to60", "noLimit"}
EQUIPMENT = {"stove", "oven", "microwave", "airFryer", "coldMeals"}
MAX_READY_TIMES = {0, 15, 30, 45, 60, 90, 120, 180}
DIETS = {"none", "vegetarian", "vegan", "pescetarian", "glutenFree", "ketogenic", "paleo"}
SPOONACULAR_DIETS = {
    "vegetarian": "vegetarian",
    "vegan": "vegan",
    "pescetarian": "pescetarian",
    "glutenFree": "gluten free",
    "ketogenic": "ketogenic",
    "paleo": "paleo",
}
SPOONACULAR_API_KEY = os.environ.get("SPOONACULAR_API_KEY", "").strip()
RECIPE_CACHE_TTL_SECONDS = 24 * 60 * 60
_RECIPE_SEARCH_CACHE = {}
_RECIPE_SEARCH_CACHE_LOCK = threading.RLock()

DEMO_RECIPES = {
    "demo-tomato-pasta": {
        "id": "demo-tomato-pasta",
        "title": "Garlicky tomato & basil pasta",
        "image": "https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=1200&q=85",
        "readyInMinutes": 25,
        "difficulty": "Beginner",
        "missingIngredients": 0,
        "servings": 2,
        "equipment": ["stove"],
        "ingredients": [
            ("pasta", "200 g pasta", 200, "g"),
            ("tomato", "2 ripe tomatoes", 2, "medium"),
            ("garlic", "2 cloves garlic", 2, "clove"),
            ("olive oil", "1 tablespoon olive oil", 1, "tbsp"),
            ("basil", "a handful of fresh basil", 1, "handful"),
            ("cheese", "30 g grated cheese", 30, "g"),
        ],
        "instructions": [
            "Bring a large pot of salted water to a boil. Cook the pasta according to the packet until just tender, then reserve a mug of pasta water before draining.",
            "While the pasta cooks, warm the olive oil in a pan over medium heat. Add the chopped garlic and cook for about 30 seconds until fragrant.",
            "Stir in the chopped tomatoes with a pinch of salt. Cook for 6–8 minutes, stirring occasionally, until they soften into a chunky sauce.",
            "Add the drained pasta and a splash of reserved pasta water. Toss until glossy, then finish with torn basil and grated cheese.",
        ],
    },
    "demo-tomato-toast": {
        "id": "demo-tomato-toast",
        "title": "Tomato, garlic & cheese toast",
        "image": "https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=1200&q=85",
        "readyInMinutes": 12,
        "difficulty": "Beginner",
        "missingIngredients": 0,
        "servings": 2,
        "equipment": ["coldMeals"],
        "ingredients": [
            ("bread", "4 slices crusty bread", 4, "slice"),
            ("tomato", "2 ripe tomatoes", 2, "medium"),
            ("garlic", "1 small garlic clove", 1, "clove"),
            ("cheese", "60 g soft or grated cheese", 60, "g"),
            ("olive oil", "1 tablespoon olive oil", 1, "tbsp"),
        ],
        "instructions": [
            "Dice the tomatoes and stir them with olive oil, a pinch of salt, and finely chopped garlic.",
            "Toast the bread until crisp. Rub each warm slice with the cut side of a garlic clove if you like a stronger garlic flavour.",
            "Spread the cheese over the toast, spoon the tomato mixture on top, and serve straight away.",
        ],
    },
    "demo-potato-omelette": {
        "id": "demo-potato-omelette",
        "title": "Cheesy potato & onion omelette",
        "image": "https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&w=1200&q=85",
        "readyInMinutes": 30,
        "difficulty": "Intermediate",
        "missingIngredients": 0,
        "servings": 2,
        "equipment": ["stove"],
        "ingredients": [
            ("egg", "4 eggs", 4, "large"),
            ("potato", "1 medium potato", 1, "medium"),
            ("onion", "½ onion", 0.5, "medium"),
            ("cheese", "50 g grated cheese", 50, "g"),
            ("olive oil", "1 tablespoon olive oil", 1, "tbsp"),
        ],
        "instructions": [
            "Peel and dice the potato into small cubes. Finely slice the onion.",
            "Warm the oil in a non-stick pan over medium heat. Add the potato and cook for 10–12 minutes, stirring now and then, until tender and golden. Add a splash of water and cover the pan briefly if the potato needs help softening.",
            "Add the onion and cook for another 3 minutes until soft.",
            "Beat the eggs with a pinch of salt and pepper, then pour them into the pan. Gently lift the edges as they set. Sprinkle over the cheese.",
            "When the centre is just set, fold the omelette in half and slide it onto a plate.",
        ],
    },
    "demo-microwave-rice": {
        "id": "demo-microwave-rice",
        "title": "Easy microwave tomato rice bowl",
        "image": "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=1200&q=85",
        "readyInMinutes": 12,
        "difficulty": "Beginner",
        "missingIngredients": 0,
        "servings": 2,
        "equipment": ["microwave"],
        "ingredients": [
            ("rice", "250 g cooked rice", 250, "g"),
            ("tomato", "1 tomato", 1, "medium"),
            ("cheese", "40 g grated cheese", 40, "g"),
            ("garlic", "¼ teaspoon garlic powder", 0.25, "tsp"),
        ],
        "instructions": [
            "Put the cooked rice in a microwave-safe bowl with the diced tomato, garlic powder, and 2 tablespoons of water.",
            "Cover loosely and microwave on high for 2 minutes. Stir, then microwave for another 1–2 minutes until piping hot.",
            "Stir through the cheese until it melts. Let the bowl stand for one minute before serving.",
        ],
    },
    "demo-air-fryer-potatoes": {
        "id": "demo-air-fryer-potatoes",
        "title": "Air-fryer garlic potatoes",
        "image": "https://images.unsplash.com/photo-1518977676601-b53f82aba655?auto=format&fit=crop&w=1200&q=85",
        "readyInMinutes": 30,
        "difficulty": "Beginner",
        "missingIngredients": 1,
        "servings": 2,
        "equipment": ["airFryer"],
        "ingredients": [
            ("potato", "3 medium potatoes", 3, "medium"),
            ("garlic", "1 clove garlic", 1, "clove"),
            ("olive oil", "1 tablespoon olive oil", 1, "tbsp"),
            ("cheese", "30 g grated cheese", 30, "g"),
        ],
        "instructions": [
            "Cut the potatoes into bite-sized chunks and pat them dry.",
            "Toss with olive oil, crushed garlic, salt, and pepper. Arrange in a single layer in the air fryer basket.",
            "Air-fry at 200°C for 20–25 minutes, shaking the basket halfway through, until crisp outside and tender inside.",
            "Scatter with grated cheese while hot and serve.",
        ],
    },
    "demo-oven-tomatoes": {
        "id": "demo-oven-tomatoes",
        "title": "Cheesy baked tomatoes on toast",
        "image": "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1200&q=85",
        "readyInMinutes": 25,
        "difficulty": "Beginner",
        "missingIngredients": 0,
        "servings": 2,
        "equipment": ["oven"],
        "ingredients": [
            ("tomato", "3 ripe tomatoes", 3, "medium"),
            ("cheese", "60 g grated cheese", 60, "g"),
            ("bread", "4 slices bread", 4, "slice"),
            ("garlic", "1 clove garlic", 1, "clove"),
            ("olive oil", "1 teaspoon olive oil", 1, "tsp"),
        ],
        "instructions": [
            "Heat the oven to 200°C. Slice the tomatoes and place them in a small oven-safe dish.",
            "Drizzle with olive oil, season with salt and pepper, and scatter over the minced garlic and grated cheese.",
            "Bake for 15–18 minutes until the tomatoes soften and the cheese bubbles.",
            "Toast the bread and spoon the baked tomatoes over the top.",
        ],
    },
}


def error_response(message, status):
    return jsonify({"error": message}), status


def normalise(value):
    return re.sub(r"[^a-z0-9]+", " ", str(value).lower()).strip()


def has_ingredient(ingredient_name, fridge_ingredients):
    candidate = normalise(ingredient_name)
    return any(
        candidate == normalise(item)
        or candidate in normalise(item)
        or normalise(item) in candidate
        for item in fridge_ingredients
    )


def recipe_summary(recipe):
    made_ids = set(session.get("madeRecipeIds", []))
    return {
        "id": str(recipe["id"]),
        "title": recipe["title"],
        "image": recipe["image"],
        "readyInMinutes": int(recipe.get("readyInMinutes") or 30),
        "difficulty": recipe.get("difficulty", "Beginner"),
        "missingIngredients": int(recipe.get("missingIngredients") or 0),
        "servings": int(recipe.get("servings") or 2),
        "made": str(recipe["id"]) in made_ids,
    }


def session_payload():
    preferences = normalized_preferences(session.get("preferences"))
    if preferences and preferences != session.get("preferences"):
        session["preferences"] = preferences
    demo_mode = bool(session.get("demoMode", False))
    recipes = session.get("recipes", [])
    if not recipes and not demo_mode and session.get("recipeIds"):
        recipes = session_real_recipe_details()
    return {
        "ingredients": session.get("ingredients", []),
        "preferences": preferences,
        "recipes": [recipe_summary(recipe) for recipe in recipes],
        "demoMode": demo_mode,
    }


def normalized_preferences(preferences):
    if not isinstance(preferences, dict):
        return None
    experience = preferences.get("experience", "beginner")
    time_available = preferences.get("timeAvailable", "15to30")
    equipment = preferences.get("equipment", ["stove"])
    max_ready_time = preferences.get("maxReadyTime", 0)
    diet = preferences.get("diet", "none")
    clean_equipment = [
        item for item in equipment
        if isinstance(item, str) and item in EQUIPMENT
    ] if isinstance(equipment, list) else []
    if not clean_equipment:
        clean_equipment = ["stove"]
    if (
        isinstance(max_ready_time, bool)
        or not isinstance(max_ready_time, int)
        or max_ready_time not in MAX_READY_TIMES
    ):
        max_ready_time = 0
    return {
        "experience": experience if isinstance(experience, str) and experience in EXPERIENCES else "beginner",
        "timeAvailable": time_available if isinstance(time_available, str) and time_available in TIME_OPTIONS else "15to30",
        "equipment": clean_equipment,
        "maxReadyTime": max_ready_time,
        "diet": diet if isinstance(diet, str) and diet in DIETS else "none",
    }


def session_recipe_ids():
    stored_ids = session.get("recipeIds")
    if isinstance(stored_ids, list):
        return {str(recipe_id) for recipe_id in stored_ids}
    return {
        str(recipe.get("id"))
        for recipe in session.get("recipes", [])
        if isinstance(recipe, dict) and recipe.get("id") is not None
    }


def scrape_steps(information):
    steps = []
    for section in information.get("analyzedInstructions") or []:
        for step in section.get("steps") or []:
            text = (step.get("step") or "").strip()
            if text:
                steps.append(text)
    if steps:
        return steps
    raw_instructions = information.get("instructions") or ""
    blocks = re.findall(r"<li\b[^>]*>(.*?)</li>", raw_instructions, flags=re.I | re.S)
    if blocks:
        return [
            html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", block))).strip()
            for block in blocks
        ]
    raw = re.sub(r"<[^>]+>", " ", raw_instructions)
    raw = html.unescape(re.sub(r"\s+", " ", raw)).strip()
    return re.split(r"(?<=[.!?])\s+(?=[A-Z])", raw) if raw else []


def difficulty_for(information):
    step_count = sum(
        len(section.get("steps") or [])
        for section in information.get("analyzedInstructions") or []
    )
    minutes = int(information.get("readyInMinutes") or 30)
    if step_count <= 5 and minutes <= 30:
        return "Beginner"
    if step_count > 10 or minutes > 60:
        return "Pro"
    return "Intermediate"


def spoonacular_get(path, params=None, api_key=None):
    query = dict(params or {})
    query["apiKey"] = api_key or SPOONACULAR_API_KEY
    url = f"https://api.spoonacular.com{path}?{urlencode(query)}"
    request_object = Request(url, headers={"Accept": "application/json"})
    with urlopen(request_object, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def spoonacular_recipe_details(search_result, information=None):
    info = information or spoonacular_get(f"/recipes/{search_result['id']}/information")
    fridge_ingredients = session.get("ingredients", [])
    ingredients = []
    for item in info.get("extendedIngredients") or []:
        name = (item.get("name") or item.get("originalName") or "").strip()
        ingredients.append(
            {
                "name": name,
                "original": item.get("original") or name,
                "amount": float(item.get("amount") or 0),
                "unit": item.get("unit") or "",
                "inFridge": has_ingredient(name, fridge_ingredients),
            }
        )
    missing_ingredients = search_result.get("missedIngredientCount")
    if missing_ingredients is None:
        missing_ingredients = sum(not ingredient["inFridge"] for ingredient in ingredients)
    recipe = {
        "id": str(info.get("id", search_result["id"])),
        "title": info.get("title") or search_result.get("title", "Untitled recipe"),
        "image": info.get("image") or search_result.get("image", ""),
        "readyInMinutes": int(info.get("readyInMinutes") or 30),
        "difficulty": difficulty_for(info),
        "missingIngredients": int(missing_ingredients or 0),
        "servings": int(info.get("servings") or 2),
        "ingredients": ingredients,
        "instructions": scrape_steps(info),
        "instructionsSimplified": False,
        "instructionsNote": None,
    }
    return recipe


def recipe_search_cache_key(ingredients, preferences):
    cache_input = {
        "ingredients": sorted({normalise(item) for item in ingredients if normalise(item)}),
        "maxReadyTime": int(preferences.get("maxReadyTime") or 0),
        "diet": preferences.get("diet", "none"),
    }
    encoded = json.dumps(cache_input, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "spoonacular-search:" + hashlib.sha256(encoded).hexdigest()


def recipe_search_cache_get(cache_key):
    now = time.time()
    with _RECIPE_SEARCH_CACHE_LOCK:
        cached = _RECIPE_SEARCH_CACHE.get(cache_key)
        if not cached:
            return None
        expires_at, value = cached
        if expires_at <= now:
            _RECIPE_SEARCH_CACHE.pop(cache_key, None)
            return None
        return value


def recipe_search_cache_set(cache_key, value):
    now = time.time()
    with _RECIPE_SEARCH_CACHE_LOCK:
        expired_keys = [
            key for key, (expires_at, _value) in _RECIPE_SEARCH_CACHE.items()
            if expires_at <= now
        ]
        for key in expired_keys:
            _RECIPE_SEARCH_CACHE.pop(key, None)
        _RECIPE_SEARCH_CACHE[cache_key] = (now + RECIPE_CACHE_TTL_SECONDS, value)


def spoonacular_search_data(ingredients, preferences, api_key=None):
    credential = hashlib.sha256((api_key or SPOONACULAR_API_KEY).encode()).hexdigest()
    cache_key = recipe_search_cache_key(ingredients, preferences) + ":10:1:" + credential
    cached = recipe_search_cache_get(cache_key)
    if cached is not None:
        return cache_key, cached

    found = spoonacular_get(
        "/recipes/findByIngredients",
        {
            "ingredients": ",".join(ingredients),
            "number": 10,
            "ranking": 1,
            "ignorePantry": "true",
        },
        api_key=api_key,
    )
    if not isinstance(found, list):
        raise ValueError("Spoonacular returned an invalid recipe list.")

    recipe_ids = [str(recipe["id"]) for recipe in found if recipe.get("id") is not None]
    if recipe_ids:
        information = spoonacular_get(
            "/recipes/informationBulk",
            {"ids": ",".join(recipe_ids), "includeNutrition": "false"},
            api_key=api_key,
        )
        if not isinstance(information, list):
            raise ValueError("Spoonacular returned invalid recipe details.")
    else:
        information = []

    data = {
        "found": found,
        "information": {
            str(recipe["id"]): recipe
            for recipe in information
            if recipe.get("id") is not None
        },
    }
    recipe_search_cache_set(cache_key, data)
    return cache_key, data


def filtered_recipe_details(search_data, preferences):
    max_ready_time = int(preferences.get("maxReadyTime") or 0)
    diet = preferences.get("diet", "none")
    expected_diet = normalise(SPOONACULAR_DIETS.get(diet, ""))
    recipes = []

    for result in search_data.get("found", []):
        recipe_id = str(result.get("id", ""))
        information = search_data.get("information", {}).get(recipe_id)
        if not information:
            continue

        try:
            ready_in_minutes = int(information.get("readyInMinutes") or 0)
        except (TypeError, ValueError):
            ready_in_minutes = 0
        if max_ready_time and (ready_in_minutes <= 0 or ready_in_minutes > max_ready_time):
            continue

        if expected_diet:
            diet_values = information.get("diets") or []
            actual_diets = {
                normalise(value) for value in diet_values if isinstance(value, str)
            } if isinstance(diet_values, list) else set()
            if expected_diet not in actual_diets:
                continue

        recipe = spoonacular_recipe_details(result, information=information)
        if not recipe["title"].strip() or not recipe["image"].strip():
            continue
        recipes.append(recipe)

    time_available = preferences.get("timeAvailable", "noLimit")
    recipes.sort(
        key=lambda recipe: (
            time_score(recipe["readyInMinutes"], time_available),
            -recipe["missingIngredients"],
        ),
        reverse=True,
    )
    return recipes


def session_real_recipe_details():
    cached = recipe_search_cache_get(session.get("recipeSearchKey"))
    if isinstance(cached, list):
        return cached
    ingredients = session.get("ingredients", [])
    preferences = normalized_preferences(session.get("preferences"))
    if not SPOONACULAR_API_KEY or not ingredients or not preferences:
        return []
    _cache_key, search_data = spoonacular_search_data(ingredients, preferences)
    return filtered_recipe_details(search_data, preferences)


def gemini_json(api_key, prompt):
    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }).encode()
    provider_request = Request(
        url, data=payload, method="POST",
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
    )
    for attempt in range(3):
        try:
            with urlopen(provider_request, timeout=40) as response:
                result = json.loads(response.read().decode())
            parts = result["candidates"][0]["content"]["parts"]
            text = "".join(part.get("text", "") for part in parts)
            return json.loads(re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip()))
        except HTTPError as error:
            if error.code not in {429, 503} or attempt == 2:
                raise
            time.sleep(2 ** attempt)


def positive_number(value, fallback):
    match = re.search(r"\d+(?:\.\d+)?", str(value))
    return max(1, int(float(match.group()))) if match else fallback


def gemini_recipe(data, pantry, source=None):
    if not isinstance(data, dict) or not isinstance(data.get("title"), str) or not data["title"].strip():
        raise ValueError("Invalid recipe format.")
    steps = data.get("steps")
    raw_ingredients = data.get("ingredients")
    if (
        not isinstance(steps, list) or len(steps) < 2
        or any(not isinstance(step, str) or not step.strip() for step in steps)
        or not isinstance(raw_ingredients, list) or not raw_ingredients
    ):
        raise ValueError("Recipe ingredients or detailed steps are missing.")
    ingredients = []
    for item in raw_ingredients:
        if isinstance(item, str):
            original = item.strip()
            match = re.match(
                r"^(\d+(?:\.\d+)?(?:/\d+)?|[¼½¾])\s*(kg|g|ml|l|cups?|tbsp|tsp|tablespoons?|teaspoons?|cloves?|slices?)?\s+(.+)$",
                original, re.I,
            )
            amount, unit, name = 0, "", original
            if match:
                quantity, unit, name = match.groups()
                fractions = {"¼": 0.25, "½": 0.5, "¾": 0.75}
                if quantity in fractions:
                    amount = fractions[quantity]
                elif "/" in quantity:
                    numerator, denominator = quantity.split("/")
                    if float(denominator) == 0:
                        raise ValueError("Invalid ingredient quantity.")
                    amount = float(numerator) / float(denominator)
                else:
                    amount = float(quantity)
                unit = unit or ""
        elif isinstance(item, dict):
            name = str(item.get("name") or item.get("ingredient") or "").strip()
            try:
                amount = float(item.get("amount") or 0)
            except (TypeError, ValueError):
                amount = 0
            unit = str(item.get("unit") or "")
            original = str(item.get("original") or " ".join(
                str(value) for value in [amount if amount else "", unit, name] if value != ""
            ))
        else:
            raise ValueError("Invalid ingredient format.")
        if not name:
            raise ValueError("An ingredient is missing its name.")
        if not math.isfinite(amount) or amount < 0:
            raise ValueError("Invalid ingredient amount.")
        ingredients.append({
            "name": name, "original": original, "amount": amount, "unit": unit,
            "inFridge": has_ingredient(name, pantry),
        })
    source = source or {}
    minutes = positive_number(data.get("cookTime"), source.get("readyInMinutes", 30))
    return {
        "id": source.get("id", ""), "title": data["title"].strip(),
        "image": source.get("image") or DEMO_RECIPES["demo-tomato-pasta"]["image"],
        "readyInMinutes": minutes, "servings": positive_number(data.get("servings"), 2),
        "difficulty": "Beginner" if minutes <= 30 and len(steps) <= 5 else "Intermediate",
        "missingIngredients": sum(not ingredient["inFridge"] for ingredient in ingredients),
        "ingredients": ingredients, "instructions": [step.strip() for step in steps],
        "instructionsSimplified": True,
        "instructionsNote": "Detailed steps generated by Gemini. Review measurements and food-safety instructions before cooking."
            + ("" if source.get("image") else " Photo is illustrative."),
    }


def hybrid_recipes(pantry, preferences, spoonacular_key, gemini_key):
    output_shape = (
        " Ingredients must include exact amounts; use objects with name, amount (number), unit, "
        "and original (amount plus ingredient). Steps must be an array of separate detailed strings."
    )
    if not spoonacular_key:
        prompt = (
            "You are a chef. Generate 10 recipes using this pantry, with very specific step-by-step "
            "instructions including exact measurements, temperatures, times, and beginner tips. "
            f"Pantry: {json.dumps(pantry)}. Preferences: {json.dumps(preferences)}. "
            "Return JSON {\"recipes\": [{\"title\": \"\", \"cookTime\": 30, \"servings\": 2, "
            "\"ingredients\": [], \"steps\": []}]}." + output_shape
        )
        result = gemini_json(gemini_key, prompt)
        recipes = result.get("recipes") if isinstance(result, dict) else result
        if not isinstance(recipes, list) or not recipes:
            raise ValueError("Gemini did not return recipes.")
        details = [gemini_recipe(recipe, pantry) for recipe in recipes[:10]]
    else:
        _key, search_data = spoonacular_search_data(pantry, preferences, api_key=spoonacular_key)
        details = filtered_recipe_details(search_data, preferences)
        if not gemini_key:
            details = [recipe for recipe in details if recipe["instructions"]]
        if gemini_key:
            def expand(source):
                prompt = (
                    "Rewrite this recipe in MAX 50 WORDS TOTAL. Must include: exact amounts, "
                    "temp in °C, and minutes. Use short, numbered steps. No fluff. Format as: "
                    "Step 1: ... Step 2: ... etc. Must be easy and accurate to follow. "
                    f"Recipe data: {json.dumps(source)}"
                )
                try:
                    contents = [{"role": "user", "parts": [{"text": prompt}]}]
                    for attempt in range(3):
                        provider_request = Request(
                            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
                            data=json.dumps({"contents": contents}).encode(),
                            method="POST",
                            headers={"Content-Type": "application/json", "x-goog-api-key": gemini_key},
                        )
                        with urlopen(provider_request, timeout=40) as response:
                            result = json.loads(response.read().decode())
                        text = "".join(
                            part.get("text", "")
                            for part in result["candidates"][0]["content"]["parts"]
                            if not part.get("thought")
                        ).strip()
                        if len(text.split()) <= 50:
                            break
                        if attempt == 2:
                            raise ValueError("Gemini exceeded the 50-word limit.")
                        contents.extend([
                            {"role": "model", "parts": [{"text": text}]},
                            {"role": "user", "parts": [{"text": "Too long, rewrite in 50 words max."}]},
                        ])
                    sections = re.split(r"\bStep\s+\d+\s*:\s*", text, flags=re.I)
                    steps = [step.strip() for step in sections[1:] if step.strip()]
                    if sections[0].strip() or not steps:
                        raise ValueError("Gemini did not return numbered steps.")
                    return {
                        **source, "instructions": steps, "instructionsSimplified": True,
                        "instructionsNote": "Detailed steps generated by Gemini. Review measurements and food-safety instructions before cooking.",
                    }
                except (HTTPError, URLError, TimeoutError, ValueError, KeyError, IndexError, TypeError):
                    return {
                        **source,
                        "instructionsNote": "Gemini could not expand this recipe. Showing Spoonacular's original steps."
                            if source["instructions"] else "Neither provider supplied cooking steps for this recipe.",
                    }
            with ThreadPoolExecutor(max_workers=3) as pool:
                details = list(pool.map(expand, details))
    maximum = int(preferences.get("maxReadyTime") or 0)
    return [recipe for recipe in details if not maximum or recipe["readyInMinutes"] <= maximum]


def demo_recipe_detail(recipe_id):
    recipe = DEMO_RECIPES.get(recipe_id)
    if recipe is None:
        return None
    fridge_ingredients = session.get("ingredients", [])
    ingredients = [
        {
            "name": name,
            "original": original,
            "amount": amount,
            "unit": unit,
            "inFridge": has_ingredient(name, fridge_ingredients),
        }
        for name, original, amount, unit in recipe["ingredients"]
    ]
    detail = {key: value for key, value in recipe.items() if key not in {"equipment"}}
    detail["ingredients"] = ingredients
    detail["missingIngredients"] = sum(not item["inFridge"] for item in ingredients)
    detail["made"] = recipe_id in session.get("madeRecipeIds", [])
    return detail


def time_score(minutes, time_available):
    if time_available == "under15":
        return 2 if minutes < 15 else 0
    if time_available == "15to30":
        return 2 if 15 <= minutes <= 30 else 0
    if time_available == "30to60":
        return 2 if 30 <= minutes <= 60 else 0
    return 1


def ranked_demo_recipes(preferences):
    selected_equipment = set(preferences.get("equipment") or [])
    time_available = preferences.get("timeAvailable", "noLimit")
    max_ready_time = int(preferences.get("maxReadyTime") or 0)
    diet = preferences.get("diet", "none")
    fridge_ingredients = session.get("ingredients", [])
    recipes = []
    for original in DEMO_RECIPES.values():
        recipe = dict(original)
        recipe["diets"] = ["vegetarian", "pescetarian"]
        recipe["missingIngredients"] = sum(
            not has_ingredient(name, fridge_ingredients)
            for name, _original, _amount, _unit in original["ingredients"]
        )
        if max_ready_time and recipe["readyInMinutes"] > max_ready_time:
            continue
        if diet != "none" and diet not in recipe["diets"]:
            continue
        recipes.append(recipe)
    recipes.sort(
        key=lambda recipe: (
            recipe["equipment"][0] in selected_equipment,
            time_score(recipe["readyInMinutes"], time_available),
            -recipe["missingIngredients"],
            recipe["title"],
        ),
        reverse=True,
    )
    return recipes[:3]


@app.before_request
def update_cookie_security():
    app.config["SESSION_COOKIE_SECURE"] = request.is_secure


@app.get("/api/scrapcook/session")
def get_session():
    session.permanent = True
    return jsonify(session_payload())


@app.put("/api/scrapcook/session")
def update_session():
    body = request.get_json(silent=True) or {}
    ingredients = body.get("ingredients")
    preferences = body.get("preferences")
    if not isinstance(ingredients, list):
        return error_response("Add at least three ingredients to continue.", 400)
    cleaned = []
    seen = set()
    for value in ingredients:
        if not isinstance(value, str):
            continue
        name = value.strip()[:60]
        key = normalise(name)
        if name and key not in seen:
            cleaned.append(name)
            seen.add(key)
    if len(cleaned) < 3:
        return error_response("Add at least three different ingredients to continue.", 400)
    if len(cleaned) > 40:
        return error_response("Please use no more than 40 ingredients.", 400)
    if preferences is not None:
        if not isinstance(preferences, dict):
            return error_response("Choose your cooking preferences before generating recipes.", 400)
        if not isinstance(preferences.get("experience"), str) or preferences.get("experience") not in EXPERIENCES:
            return error_response("Choose a cooking experience level.", 400)
        if not isinstance(preferences.get("timeAvailable"), str) or preferences.get("timeAvailable") not in TIME_OPTIONS:
            return error_response("Choose how much time you have.", 400)
        equipment = preferences.get("equipment")
        if (
            not isinstance(equipment, list)
            or not equipment
            or any(not isinstance(item, str) or item not in EQUIPMENT for item in equipment)
        ):
            return error_response("Choose at least one available cooking option.", 400)
        max_ready_time = preferences.get("maxReadyTime", 0)
        if (
            isinstance(max_ready_time, bool)
            or not isinstance(max_ready_time, int)
            or max_ready_time not in MAX_READY_TIMES
        ):
            return error_response("Choose a valid maximum recipe time.", 400)
        diet = preferences.get("diet", "none")
        if not isinstance(diet, str) or diet not in DIETS:
            return error_response("Choose a valid diet preference.", 400)

    session["ingredients"] = cleaned
    session["preferences"] = (
        {
            "experience": preferences["experience"],
            "timeAvailable": preferences["timeAvailable"],
            "equipment": list(dict.fromkeys(equipment)),
            "maxReadyTime": preferences.get("maxReadyTime", 0),
            "diet": preferences.get("diet", "none"),
        }
        if preferences is not None
        else None
    )
    session["recipes"] = []
    session["recipeIds"] = []
    session["recipeSearchKey"] = None
    session["madeRecipeIds"] = []
    session["demoMode"] = False
    session.permanent = True
    return jsonify(session_payload())


@app.post("/api/scrapcook/recipes")
def generate_recipes():
    ingredients = session.get("ingredients", [])
    preferences = session.get("preferences")
    if len(ingredients) < 3 or not preferences:
        return error_response("Add at least three ingredients and choose your preferences first.", 400)

    body = request.get_json(silent=True) or {}
    spoonacular_key = body.get("spoonacularApiKey", "")
    gemini_key = body.get("geminiApiKey", "")
    if not isinstance(spoonacular_key, str) or not isinstance(gemini_key, str):
        return error_response("Enter valid API keys in Settings.", 400)
    spoonacular_key, gemini_key = spoonacular_key.strip(), gemini_key.strip()
    if not spoonacular_key and not gemini_key:
        return error_response("Add API keys in Settings", 400)

    try:
        search_key = "hybrid:" + hashlib.sha256(json.dumps(
            [ingredients, preferences, spoonacular_key, gemini_key], sort_keys=True,
        ).encode()).hexdigest()
        details = recipe_search_cache_get(search_key)
        if details is None:
            details = hybrid_recipes(ingredients, preferences, spoonacular_key, gemini_key)
            batch_id = os.urandom(10).hex()
            details = [
                {**recipe, "id": f"generated-{batch_id}-{index}"}
                for index, recipe in enumerate(details)
            ]
            recipe_search_cache_set(search_key, details)
        session["madeRecipeIds"] = []
        session["recipes"] = [recipe_summary(recipe) for recipe in details]
        session["recipeIds"] = [str(recipe["id"]) for recipe in details]
        session["recipeSearchKey"] = search_key
        session["demoMode"] = False
        session["madeRecipeIds"] = []
        session.permanent = True
        return jsonify(
            {
                "recipes": [recipe_summary(recipe) for recipe in session["recipes"]],
                "demoMode": False,
            }
        )
    except (HTTPError, URLError, TimeoutError, KeyError, IndexError, ValueError, TypeError):
        app.logger.error("Recipe provider request failed; credentials and provider response omitted.")
        return error_response(
            "Could not generate recipes right now. Check your API keys in Settings and try again.",
            502,
        )


@app.get("/api/scrapcook/recipes/<recipe_id>")
def get_recipe(recipe_id):
    if recipe_id not in session_recipe_ids():
        return error_response("This recipe is no longer in your cooking session. Generate recipes again.", 404)
    search_key = session.get("recipeSearchKey", "")
    if isinstance(search_key, str) and search_key.startswith("hybrid:"):
        details = recipe_search_cache_get(search_key)
        detail = next((recipe for recipe in details or [] if recipe["id"] == recipe_id), None)
        if detail is None:
            return error_response("This recipe's details have expired. Generate recipes again.", 404)
        return jsonify({**detail, "made": recipe_id in session.get("madeRecipeIds", [])})
    if session.get("demoMode"):
        detail = demo_recipe_detail(recipe_id)
        if detail is None:
            return error_response("Recipe details could not be found.", 404)
        return jsonify(
            {
                **detail,
                "instructionsSimplified": False,
                "instructionsNote": None,
            }
        )

    try:
        preferences = normalized_preferences(session.get("preferences"))
        if not preferences:
            return error_response("Choose your preferences and generate recipes again.", 400)
        _cache_key, search_data = spoonacular_search_data(
            session.get("ingredients", []),
            preferences,
        )
        search_result = next(
            (
                recipe for recipe in search_data.get("found", [])
                if str(recipe.get("id")) == recipe_id
            ),
            {"id": recipe_id},
        )
        found = search_data.get("information", {}).get(recipe_id)
        if not found:
            found = spoonacular_get(
                f"/recipes/{recipe_id}/information",
                {"includeNutrition": "false"},
            )
        detail = spoonacular_recipe_details(
            {
                **search_result,
                "id": found.get("id", recipe_id),
            },
            information=found,
        )
        return jsonify({**detail, "made": recipe_id in session.get("madeRecipeIds", [])})
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, KeyError, ValueError):
        app.logger.error("Recipe detail request failed; credentials and provider response omitted.")
        return error_response("Could not load this recipe right now. Please try again.", 502)


@app.post("/api/scrapcook/recipes/<recipe_id>/made")
def mark_recipe_made(recipe_id):
    if recipe_id not in session_recipe_ids():
        return error_response("This recipe is no longer in your cooking session.", 404)
    made_ids = set(session.get("madeRecipeIds", []))
    made_ids.add(recipe_id)
    session["madeRecipeIds"] = sorted(made_ids)
    session.permanent = True
    return jsonify({"recipeId": recipe_id, "made": True})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("SCRAPCOOK_PY_PORT", "5087")), threaded=True)