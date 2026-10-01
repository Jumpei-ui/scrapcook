import html
import json
import os
import re
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
SPOONACULAR_API_KEY = os.environ.get("SPOONACULAR_API_KEY", "").strip()

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
    return {
        "ingredients": session.get("ingredients", []),
        "preferences": session.get("preferences"),
        "recipes": [recipe_summary(recipe) for recipe in session.get("recipes", [])],
        "demoMode": bool(session.get("demoMode", not SPOONACULAR_API_KEY)),
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
    raw = re.sub(r"<[^>]+>", " ", information.get("instructions") or "")
    raw = html.unescape(re.sub(r"\s+", " ", raw)).strip()
    return [raw] if raw else ["Follow the preparation instructions provided with this recipe."]


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


def spoonacular_get(path, params=None):
    query = dict(params or {})
    query["apiKey"] = SPOONACULAR_API_KEY
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
    recipe = {
        "id": str(info.get("id", search_result["id"])),
        "title": info.get("title") or search_result.get("title", "Untitled recipe"),
        "image": info.get("image") or search_result.get("image", ""),
        "readyInMinutes": int(info.get("readyInMinutes") or 30),
        "difficulty": difficulty_for(info),
        "missingIngredients": int(search_result.get("missedIngredientCount") or 0),
        "servings": int(info.get("servings") or 2),
        "ingredients": ingredients,
        "instructions": scrape_steps(info),
    }
    return recipe


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
    fridge_ingredients = session.get("ingredients", [])
    recipes = []
    for original in DEMO_RECIPES.values():
        recipe = dict(original)
        recipe["missingIngredients"] = sum(
            not has_ingredient(name, fridge_ingredients)
            for name, _original, _amount, _unit in original["ingredients"]
        )
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
        if preferences.get("experience") not in EXPERIENCES:
            return error_response("Choose a cooking experience level.", 400)
        if preferences.get("timeAvailable") not in TIME_OPTIONS:
            return error_response("Choose how much time you have.", 400)
        equipment = preferences.get("equipment")
        if (
            not isinstance(equipment, list)
            or not equipment
            or any(item not in EQUIPMENT for item in equipment)
        ):
            return error_response("Choose at least one available cooking option.", 400)

    session["ingredients"] = cleaned
    session["preferences"] = (
        {
            "experience": preferences["experience"],
            "timeAvailable": preferences["timeAvailable"],
            "equipment": list(dict.fromkeys(equipment)),
        }
        if preferences is not None
        else None
    )
    session["recipes"] = []
    session["madeRecipeIds"] = []
    session["demoMode"] = not SPOONACULAR_API_KEY
    session.permanent = True
    return jsonify(session_payload())


@app.post("/api/scrapcook/recipes")
def generate_recipes():
    ingredients = session.get("ingredients", [])
    preferences = session.get("preferences")
    if len(ingredients) < 3 or not preferences:
        return error_response("Add at least three ingredients and choose your preferences first.", 400)

    if not SPOONACULAR_API_KEY:
        recipes = ranked_demo_recipes(preferences)
        session["recipes"] = [
            {
                key: recipe[key]
                for key in (
                    "id",
                    "title",
                    "image",
                    "readyInMinutes",
                    "difficulty",
                    "missingIngredients",
                    "servings",
                )
            }
            for recipe in recipes
        ]
        session["demoMode"] = True
        session["madeRecipeIds"] = []
        session.permanent = True
        return jsonify(
            {
                "recipes": [recipe_summary(recipe) for recipe in session["recipes"]],
                "demoMode": True,
            }
        )

    try:
        found = spoonacular_get(
            "/recipes/findByIngredients",
            {
                "ingredients": ",".join(ingredients),
                "number": 3,
                "ranking": 2,
                "ignorePantry": "true",
            },
        )
        if not isinstance(found, list) or len(found) < 3:
            return error_response(
                "Spoonacular returned fewer than three matching recipes. Try adding more ingredients.",
                502,
            )
        with ThreadPoolExecutor(max_workers=3) as pool:
            details = list(pool.map(spoonacular_recipe_details, found[:3]))
        if len(details) != 3:
            return error_response("Spoonacular could not load three complete recipes. Please try again.", 502)
        session["recipes"] = [
            {
                key: recipe[key]
                for key in (
                    "id",
                    "title",
                    "image",
                    "readyInMinutes",
                    "difficulty",
                    "missingIngredients",
                    "servings",
                )
            }
            for recipe in details
        ]
        session["demoMode"] = False
        session["madeRecipeIds"] = []
        session.permanent = True
        return jsonify(
            {
                "recipes": [recipe_summary(recipe) for recipe in session["recipes"]],
                "demoMode": False,
            }
        )
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, KeyError, ValueError):
        app.logger.exception("Recipe provider request failed")
        return error_response(
            "Spoonacular could not provide recipes right now. Check the Spoonacular key and try again.",
            502,
        )


@app.get("/api/scrapcook/recipes/<recipe_id>")
def get_recipe(recipe_id):
    recipe_ids = {str(recipe["id"]) for recipe in session.get("recipes", [])}
    if recipe_id not in recipe_ids:
        return error_response("This recipe is no longer in your cooking session. Generate recipes again.", 404)
    if session.get("demoMode"):
        detail = demo_recipe_detail(recipe_id)
        if detail is None:
            return error_response("Recipe details could not be found.", 404)
        return jsonify(detail)

    try:
        found = spoonacular_get(f"/recipes/{recipe_id}/information")
        detail = spoonacular_recipe_details(
            {
                "id": found.get("id", recipe_id),
                "title": found.get("title", ""),
                "image": found.get("image", ""),
                "missedIngredientCount": next(
                    (
                        recipe.get("missingIngredients", 0)
                        for recipe in session.get("recipes", [])
                        if str(recipe.get("id")) == recipe_id
                    ),
                    0,
                ),
            },
            information=found,
        )
        return jsonify({**detail, "made": recipe_id in session.get("madeRecipeIds", [])})
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, KeyError, ValueError):
        app.logger.exception("Recipe detail request failed")
        return error_response("Could not load this recipe right now. Please try again.", 502)


@app.post("/api/scrapcook/recipes/<recipe_id>/made")
def mark_recipe_made(recipe_id):
    recipe_ids = {str(recipe["id"]) for recipe in session.get("recipes", [])}
    if recipe_id not in recipe_ids:
        return error_response("This recipe is no longer in your cooking session.", 404)
    made_ids = set(session.get("madeRecipeIds", []))
    made_ids.add(recipe_id)
    session["madeRecipeIds"] = sorted(made_ids)
    session.permanent = True
    return jsonify({"recipeId": recipe_id, "made": True})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("SCRAPCOOK_PY_PORT", "5087")), threaded=True)