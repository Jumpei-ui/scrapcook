import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChefHat,
  Clock3,
  CookingPot,
  Leaf,
  LoaderCircle,
  Plus,
  Search,
  TrendingUp,
  Sparkles,
  X,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  getGetScrapCookSessionQueryKey,
  useGetScrapCookSession,
  useUpdateScrapCookSession,
} from "@workspace/api-client-react";
import type {
  CookingPreferences,
  RecipeSummary,
  RecipeResults,
  ScrapCookSession,
} from "@workspace/api-client-react";
import CookedMealDialog from "@/components/cooked-meal-dialog";
import { useShowNutrition } from "@/hooks/use-show-nutrition";
import RecipesPaused from "@/components/recipes-paused";
import { getPersonalRecipeKeys } from "@/lib/personal-recipe-keys";
import type { RecipePauseStatus } from "@workspace/api-client-react";

class RecipesPausedError extends Error {
  constructor(public status: RecipePauseStatus) { super(status.message); }
}

type FlowStep = "ingredients" | "preferences" | "results";
type EquipmentChoice = CookingPreferences["equipment"][number];

const commonIngredients = [
  "Eggs",
  "Rice",
  "Chicken breast",
  "Cheese",
  "Milk",
  "Onion",
  "Garlic",
  "Tomato",
  "Pasta",
  "Bread",
  "Potato",
  "Carrot",
  "Spinach",
  "Beans",
  "Mushrooms",
  "Lemon",
  "Bell pepper",
  "Yogurt",
  "Butter",
  "Tuna",
  "Avocado",
  "Broccoli",
];

const experienceChoices: { value: CookingPreferences["experience"]; title: string; detail: string }[] = [
  { value: "beginner", title: "Beginner", detail: "Keep it simple" },
  { value: "intermediate", title: "Intermediate", detail: "I know my way around" },
  { value: "pro", title: "Pro", detail: "Bring on the challenge" },
];

const timeChoices: { value: CookingPreferences["timeAvailable"]; title: string; detail: string }[] = [
  { value: "under15", title: "<15 mins", detail: "A quick one" },
  { value: "15to30", title: "15–30 mins", detail: "A little breathing room" },
  { value: "30to60", title: "30–60 mins", detail: "Take your time" },
  { value: "noLimit", title: "No limit", detail: "I'm not in a rush" },
];

const maxReadyTimeChoices: { value: CookingPreferences["maxReadyTime"]; label: string }[] = [
  { value: 0, label: "No maximum" },
  { value: 15, label: "15 minutes" },
  { value: 30, label: "30 minutes" },
  { value: 45, label: "45 minutes" },
  { value: 60, label: "1 hour" },
  { value: 90, label: "1½ hours" },
  { value: 120, label: "2 hours" },
  { value: 180, label: "3 hours" },
];

const dietChoices: { value: CookingPreferences["diet"]; label: string }[] = [
  { value: "none", label: "No preference" },
  { value: "vegetarian", label: "Vegetarian" },
  { value: "vegan", label: "Vegan" },
  { value: "pescetarian", label: "Pescetarian" },
  { value: "glutenFree", label: "Gluten-free" },
  { value: "ketogenic", label: "Keto" },
  { value: "paleo", label: "Paleo" },
];

const equipmentChoices: { value: EquipmentChoice; title: string; note: string }[] = [
  { value: "stove", title: "Stove", note: "Hob or hotplate" },
  { value: "oven", title: "Oven", note: "Bake or roast" },
  { value: "microwave", title: "Microwave", note: "Quick and easy" },
  { value: "airFryer", title: "Air fryer", note: "Crisp with less oil" },
  { value: "coldMeals", title: "No equipment", note: "Cold meals only" },
];

const defaultPreferences: CookingPreferences = {
  experience: "beginner",
  timeAvailable: "15to30",
  equipment: ["stove"],
  maxReadyTime: 0,
  diet: "none",
};

const stepTitles: { value: FlowStep; title: string; number: string }[] = [
  { value: "ingredients", title: "Your fridge", number: "01" },
  { value: "preferences", title: "Your style", number: "02" },
  { value: "results", title: "Your recipes", number: "03" },
];

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return fallback;
}

function updateCachedSession(queryClient: ReturnType<typeof useQueryClient>, value: ScrapCookSession) {
  queryClient.setQueryData(getGetScrapCookSessionQueryKey(), value);
}

function Header({ snackMode, onModeChange, onFindRecipes, disabled }: {
  snackMode: boolean;
  onModeChange: (snacks: boolean) => void;
  onFindRecipes: () => void;
  disabled: boolean;
}) {
  return (
    <header className="sc-header" style={{ flexWrap: "wrap", gap: 8 }}>
      <Link className="sc-brand" href="/" aria-label="ScrapCook home" data-testid="link-scrapcook-home">
        <span className="sc-brand-mark"><CookingPot size={19} strokeWidth={2.3} /></span>
        <span>scrap<span>cook</span></span>
      </Link>
      <div className="sc-header-note">
        <Leaf size={15} />
        <span>Good food. Less waste.</span>
      </div>
      <nav className="sc-header-links" aria-label="Your ScrapCook" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
        <Link href="/" className="sc-nav-link" onClick={(event) => { if (disabled) event.preventDefault(); else onFindRecipes(); }}>Find Recipes</Link>
        <div className="sc-savings-actions" role="group" aria-label="Recipe mode" style={{ width: "auto" }}>
          <button type="button" className="sc-tool-button" aria-pressed={!snackMode} disabled={disabled} onClick={() => onModeChange(false)} data-testid="button-mode-meals"
            style={!snackMode ? { background: "var(--sc-green)", borderColor: "var(--sc-green)", color: "white" } : undefined}>Meals</button>
          <button type="button" className="sc-tool-button" aria-pressed={snackMode} disabled={disabled} onClick={() => onModeChange(true)} data-testid="button-mode-snacks"
            style={snackMode ? { background: "var(--sc-green)", borderColor: "var(--sc-green)", color: "white" } : undefined}>{snackMode ? "Snack Mode On" : "Snacks"}</button>
        </div>
        <Link href="/savings" className="sc-nav-link"><TrendingUp size={15} /> Savings</Link>
        <Link href="/settings" className="sc-nav-link">Settings</Link>
      </nav>
    </header>
  );
}

function Stepper({ step }: { step: FlowStep }) {
  const currentIndex = stepTitles.findIndex((item) => item.value === step);
  return (
    <div className="sc-stepper" aria-label="Recipe finder progress">
      {stepTitles.map((item, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <div className={`sc-step ${active ? "is-active" : ""} ${done ? "is-done" : ""}`} key={item.value}>
            <span className="sc-step-number">{done ? <Check size={13} /> : item.number}</span>
            <span>{item.title}</span>
            {index < stepTitles.length - 1 && <span className="sc-step-line" aria-hidden="true" />}
          </div>
        );
      })}
    </div>
  );
}

function Footer() {
  return (
    <footer className="sc-footer">
      <span>Made with ScrapCook</span>
      <span className="sc-footer-dot">-</span>
      <span>Stop wasting food</span>
    </footer>
  );
}

function IngredientCard({
  ingredients,
  setIngredients,
}: {
  ingredients: string[];
  setIngredients: (next: string[]) => void;
}) {
  const [search, setSearch] = useState("");

  const addIngredient = (rawName: string) => {
    const value = rawName.trim().toLowerCase().slice(0, 30);
    if (!value || ingredients.some((item) => item.trim().toLowerCase() === value)) {
      setSearch("");
      return;
    }
    if (ingredients.length >= 40) return;
    setIngredients([...ingredients, value]);
    setSearch("");
  };

  return (
    <div className="sc-card sc-ingredient-card">
      <div className="sc-card-kicker"><span className="sc-kicker-dot" /> YOUR INGREDIENTS</div>
      <form
        className="sc-search-wrap"
        onSubmit={(event) => {
          event.preventDefault();
          addIngredient(search);
        }}
      >
        <Search size={18} aria-hidden="true" />
        <input
          id="ingredient-search"
          type="text"
          aria-label="Ingredient"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          maxLength={30}
          placeholder="Type any ingredient... baking powder, mango, milk, chili flakes"
          autoComplete="off"
          data-testid="input-ingredient-search"
        />
        <button
          className="sc-search-add"
          style={{ width: "auto", padding: "0 10px", whiteSpace: "nowrap" }}
          type="submit"
          disabled={!search.trim() || ingredients.length >= 40}
          data-testid="button-add-custom-ingredient"
        >
          Add Ingredient
        </button>
      </form>

      <div className="sc-selected-heading">
        <span>In your fridge</span>
        <span className="sc-count" data-testid="text-ingredient-count">{ingredients.length} added</span>
      </div>
      {ingredients.length > 0 ? (
        <div className="sc-tags" aria-label="Selected ingredients">
          {ingredients.map((ingredient) => (
            <span className="sc-tag" key={ingredient.toLowerCase()} data-testid={`tag-ingredient-${ingredient.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
              {ingredient}
              <button
                type="button"
                onClick={() => setIngredients(ingredients.filter((item) => item !== ingredient))}
                aria-label={`Remove ${ingredient}`}
                data-testid={`button-remove-ingredient-${ingredient.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="sc-empty-fridge">
          <span className="sc-empty-icon"><CookingPot size={20} /></span>
          <span>Add a few ingredients to get started.</span>
        </div>
      )}
      <p className="sc-hint">Add at least 3 ingredients. Type an ingredient and press Enter or Add Ingredient.</p>
    </div>
  );
}

function ChoiceGroup<T extends string>({
  title,
  helper,
  value,
  choices,
  onChange,
  testPrefix,
}: {
  title: string;
  helper: string;
  value: T;
  choices: { value: T; title: string; detail: string }[];
  onChange: (value: T) => void;
  testPrefix: string;
}) {
  return (
    <section className="sc-pref-section">
      <div className="sc-pref-title-row">
        <h3>{title}</h3>
        <span>{helper}</span>
      </div>
      <div className="sc-choice-row">
        {choices.map((choice) => (
          <button
            type="button"
            key={choice.value}
            className={`sc-choice ${value === choice.value ? "is-selected" : ""}`}
            onClick={() => onChange(choice.value)}
            aria-pressed={value === choice.value}
            data-testid={`${testPrefix}-${choice.value}`}
          >
            <span className="sc-choice-title">{choice.title}</span>
            <span className="sc-choice-detail">{choice.detail}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function PreferencesCard({
  preferences,
  setPreferences,
}: {
  preferences: CookingPreferences;
  setPreferences: (next: CookingPreferences) => void;
}) {
  const toggleEquipment = (equipment: EquipmentChoice) => {
    let next: EquipmentChoice[];
    if (equipment === "coldMeals") {
      next = preferences.equipment.includes("coldMeals") ? [] : ["coldMeals"];
    } else {
      const withoutCold = preferences.equipment.filter((item) => item !== "coldMeals");
      next = withoutCold.includes(equipment)
        ? withoutCold.filter((item) => item !== equipment)
        : [...withoutCold, equipment];
    }
    setPreferences({ ...preferences, equipment: next });
  };

  return (
    <div className="sc-card sc-preferences-card">
      <div className="sc-card-kicker"><span className="sc-kicker-dot sc-kicker-orange" /> A LITTLE ABOUT YOUR COOKING</div>
      <ChoiceGroup
        title="Cooking experience"
        helper="We’ll find your level"
        value={preferences.experience}
        choices={experienceChoices}
        onChange={(experience) => setPreferences({ ...preferences, experience })}
        testPrefix="button-experience"
      />
      <ChoiceGroup
        title="Time available"
        helper="From quick bites to slow Sundays"
        value={preferences.timeAvailable}
        choices={timeChoices}
        onChange={(timeAvailable) => setPreferences({ ...preferences, timeAvailable })}
        testPrefix="button-time"
      />
      <section className="sc-pref-section">
        <div className="sc-pref-title-row">
          <h3>Recipe filters</h3>
          <span>Only show recipes that fit</span>
        </div>
        <div className="sc-filter-grid">
          <label className="sc-filter-control">
            <span>Maximum recipe time</span>
            <select
              value={preferences.maxReadyTime}
              onChange={(event) => setPreferences({
                ...preferences,
                maxReadyTime: Number(event.target.value) as CookingPreferences["maxReadyTime"],
              })}
              data-testid="select-max-ready-time"
            >
              {maxReadyTimeChoices.map((choice) => (
                <option key={choice.value} value={choice.value}>{choice.label}</option>
              ))}
            </select>
          </label>
          <label className="sc-filter-control">
            <span>Diet</span>
            <select
              value={preferences.diet}
              onChange={(event) => setPreferences({
                ...preferences,
                diet: event.target.value as CookingPreferences["diet"],
              })}
              data-testid="select-diet"
            >
              {dietChoices.map((choice) => (
                <option key={choice.value} value={choice.value}>{choice.label}</option>
              ))}
            </select>
          </label>
        </div>
      </section>
      <section className="sc-pref-section">
        <div className="sc-pref-title-row">
          <h3>Equipment available</h3>
          <span>Choose everything you can use</span>
        </div>
        <div className="sc-equipment-grid">
          {equipmentChoices.map((choice) => {
            const selected = preferences.equipment.includes(choice.value);
            return (
              <button
                type="button"
                className={`sc-equipment ${selected ? "is-selected" : ""}`}
                key={choice.value}
                onClick={() => toggleEquipment(choice.value)}
                aria-pressed={selected}
                data-testid={`button-equipment-${choice.value}`}
              >
                <span className="sc-equipment-check">{selected && <Check size={13} />}</span>
                <span><strong>{choice.title}</strong><small>{choice.note}</small></span>
              </button>
            );
          })}
        </div>
        {preferences.equipment.length === 0 && (
          <p className="sc-inline-error" role="alert" data-testid="status-equipment-required">
            Choose at least one cooking option.
          </p>
        )}
      </section>
    </div>
  );
}

function RecipeCard({ recipe, index, snackMode, showNutrition }: { recipe: RecipeSummary; index: number; snackMode: boolean; showNutrition: boolean }) {
  const imageLabel = `Photo of ${recipe.title}`;
  return (
    <article className="sc-recipe-card" data-testid={`card-recipe-${recipe.id}`}>
      <div className="sc-recipe-image-wrap">
        <img
          src={recipe.image}
          alt={imageLabel}
          loading="lazy"
          onError={(event) => { event.currentTarget.style.visibility = "hidden"; }}
          data-testid={`img-recipe-${recipe.id}`}
        />
      <span className="sc-recipe-index">{String(index + 1).padStart(2, "0")}</span>
        {recipe.made && <span className="sc-made-label"><Check size={12} /> Made</span>}
      </div>
      <div className="sc-recipe-content">
        <div className="sc-recipe-meta">
          <span><Clock3 size={14} /> {recipe.readyInMinutes} min</span>
          <span className="sc-meta-divider" />
          <span>{recipe.difficulty}</span>
          {snackMode && <span className="sc-count" data-testid={`tag-snack-${recipe.id}`}>15 min or less</span>}
        </div>
        <h3 data-testid={`text-recipe-title-${recipe.id}`}>{recipe.title}</h3>
        <p className={recipe.missingIngredients > 0 ? "sc-missing" : "sc-missing sc-all-have"} data-testid={`text-missing-${recipe.id}`}>
          {recipe.missingIngredients === 0
            ? "You have everything"
            : `${recipe.missingIngredients} missing ingredient${recipe.missingIngredients === 1 ? "" : "s"}`}
        </p>
        <Link
          className="sc-view-recipe"
          href={`/recipe/${encodeURIComponent(recipe.id)}`}
          data-testid={`link-view-recipe-${recipe.id}`}
        >
          View recipe <ArrowRight size={16} />
        </Link>
        <CookedMealDialog
          recipeId={recipe.id}
          recipeName={recipe.title}
          triggerClassName="sc-card-cooked-link"
          triggerLabel="I Cooked This!"
        />
        {showNutrition && <p className="sc-hint" data-testid={`nutrition-recipe-${recipe.id}`}>
          {recipe.nutrition ? (
            <>
              Nutrition per serving — Calories: {Math.round(recipe.nutrition.calories)}
              <br />
              Protein: {Math.round(recipe.nutrition.protein)}g | Carbs: {Math.round(recipe.nutrition.carbs)}g | Fat: {Math.round(recipe.nutrition.fat)}g | Fiber: {Math.round(recipe.nutrition.fiber)}g
            </>
          ) : (
            <>Nutrition per serving<br />Nutrition info unavailable</>
          )}
        </p>}
      </div>
    </article>
  );
}

async function requestRecipes(ingredients: string[], preferences: CookingPreferences, snackMode: boolean, showNutrition: boolean): Promise<RecipeResults> {
  const personal = getPersonalRecipeKeys();
  const response = await fetch("/api/getRecipes", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ingredients, preferences, snackMode, showNutrition,
      ...(personal.userSpoonKey ? { userSpoonKey: personal.userSpoonKey, ...(personal.userGemKey ? { userGemKey: personal.userGemKey } : {}) } : {}),
    }),
  });
  const result = await response.json();
  if (result.paused) throw new RecipesPausedError(result);
  if (!response.ok) throw new Error(result.error ?? "Could not generate recipes. Please try again.");
  return result as RecipeResults;
}

export default function HomePage() {
  const queryClient = useQueryClient();
  const [showNutrition] = useShowNutrition();
  const sessionQuery = useGetScrapCookSession({
    request: { headers: { "X-Show-Nutrition": String(showNutrition) } },
  });
  const saveSession = useUpdateScrapCookSession();
  const generateRecipes = useMutation({ mutationFn: (snacks: boolean) => requestRecipes(ingredients, preferences, snacks, showNutrition) });
  const [step, setStep] = useState<FlowStep>("ingredients");
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [preferences, setPreferences] = useState<CookingPreferences>(defaultPreferences);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState("");
  const [snackMode, setSnackMode] = useState(false);
  const [pause, setPause] = useState<RecipePauseStatus | null>(null);
  const [checkingPause, setCheckingPause] = useState(true);
  const checkPause = useCallback(async () => {
    if (getPersonalRecipeKeys().userSpoonKey) { setPause(null); setCheckingPause(false); return; }
    try {
      const response = await fetch("/api/recipes/status", { cache: "no-store" });
      if (response.ok) {
        const status: RecipePauseStatus = await response.json();
        setPause(status.paused ? status : null);
      }
    } finally { setCheckingPause(false); }
  }, []);
  useEffect(() => {
    const check = () => { void checkPause().catch(() => {}); };
    check();
    const timer = setInterval(check, 30000);
    return () => clearInterval(timer);
  }, [checkPause]);
  const handleRecipeError = (cause: unknown) => {
    if (cause instanceof RecipesPausedError) { setPause(cause.status); setError(""); return; }
    setError(errorMessage(cause, "We couldn't find recipes just now. Please try again."));
  };

  useEffect(() => {
    const saved = sessionQuery.data;
    if (!saved || hydrated) return;
    setIngredients(saved.ingredients);
    if (saved.preferences) {
      setPreferences({
        ...defaultPreferences,
        ...saved.preferences,
        maxReadyTime: saved.preferences.maxReadyTime ?? defaultPreferences.maxReadyTime,
        diet: saved.preferences.diet ?? defaultPreferences.diet,
      });
    }
    if (saved.recipes.length > 0) setStep("results");
    else if (saved.ingredients.length >= 3) setStep("preferences");
    setHydrated(true);
  }, [hydrated, sessionQuery.data]);

  const saveIngredientsAndContinue = () => {
    setError("");
    saveSession.mutate(
      { data: { ingredients, preferences: null } },
      {
        onSuccess: (saved) => {
          updateCachedSession(queryClient, saved);
          setStep("preferences");
        },
        onError: (cause) => setError(errorMessage(cause, "We couldn't save your ingredients. Please try again.")),
      },
    );
  };

  const savePreferencesAndGenerate = () => {
    if (preferences.equipment.length === 0) {
      setError("Choose at least one cooking option to continue.");
      return;
    }
    setError("");
    saveSession.mutate(
      { data: { ingredients, preferences } },
      {
        onSuccess: (saved) => {
          updateCachedSession(queryClient, saved);
          generateRecipes.mutate(snackMode, {
            onSuccess: (result) => {
              const updated: ScrapCookSession = {
                ...saved,
                recipes: result.recipes,
                demoMode: result.demoMode,
              };
              updateCachedSession(queryClient, updated);
              setStep("results");
            },
            onError: handleRecipeError,
          });
        },
        onError: (cause) => setError(errorMessage(cause, "We couldn't save your preferences. Please try again.")),
      },
    );
  };

  const regenerate = () => {
    setError("");
    generateRecipes.mutate(snackMode, {
      onSuccess: (result) => {
        const current = queryClient.getQueryData<ScrapCookSession>(getGetScrapCookSessionQueryKey());
        if (current) updateCachedSession(queryClient, { ...current, recipes: result.recipes, demoMode: result.demoMode });
      },
      onError: handleRecipeError,
    });
  };

  const goToIngredients = () => {
    setError("");
    setStep("ingredients");
  };

  const recipes = (sessionQuery.data?.recipes ?? []).filter((recipe) =>
    !snackMode || (recipe.readyInMinutes <= 15 && !/dinner|lunch|main[\s-]+course/i.test(recipe.title)),
  );
  const loading = saveSession.isPending || generateRecipes.isPending;
  const header = <Header
    snackMode={snackMode}
    disabled={loading || !hydrated}
    onFindRecipes={() => { setError(""); setStep(ingredients.length >= 3 ? "preferences" : "ingredients"); }}
    onModeChange={(next) => {
      setSnackMode(next);
      setError("");
      if (step === "results" && next !== snackMode) setStep("preferences");
    }}
  />;

  if (pause) return <RecipesPaused resumesAt={pause.resumesAt} onCheck={checkPause} />;

  if (sessionQuery.isError) {
    return (
      <div className="sc-app">
        {header}
        <main className="sc-page sc-loading-page">
          <h1>We couldn't reach the kitchen.</h1>
          <p>Refresh the page to start your recipe search.</p>
          <button className="sc-button sc-button-primary" onClick={() => sessionQuery.refetch()} data-testid="button-retry-session">Try again</button>
        </main>
        <Footer />
      </div>
    );
  }

  if (sessionQuery.isLoading || !hydrated || checkingPause) {
    return (
      <div className="sc-app">
        {header}
        <main className="sc-page sc-loading-page">
          <div className="sc-loader-mark"><CookingPot size={22} /></div>
          <p>Getting your kitchen ready…</p>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="sc-app">
      {header}
      <main className="sc-page">
        <Stepper step={step} />
        {step === "ingredients" && (
          <section className="sc-stage" aria-labelledby="page-title-ingredients">
            <div className="sc-stage-heading">
              <div className="sc-eyebrow"><Sparkles size={14} /> MAKE SOMETHING FROM WHAT YOU HAVE</div>
              <h1 id="page-title-ingredients">What’s in your <em>fridge?</em></h1>
              <p>Tell us what you’ve got. We’ll find something worth cooking.</p>
            </div>
            <div className="sc-ingredient-layout">
              <IngredientCard ingredients={ingredients} setIngredients={setIngredients} />
              <aside className="sc-side-note">
                <div className="sc-side-photo">
                  <img
                    src="https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=900&q=85"
                    alt="A colourful spread of fresh ingredients"
                    loading="lazy"
                    data-testid="img-fresh-ingredients"
                  />
                  <div className="sc-photo-caption">
                    <span className="sc-photo-leaf"><Leaf size={16} /></span>
                    <span>Good things start<br />with what you have.</span>
                  </div>
                </div>
                <div className="sc-side-note-copy">
                  <strong>Less waste, more “wow”.</strong>
                  <span>Three ingredients is all it takes to get started.</span>
                </div>
              </aside>
            </div>
            {error && <p className="sc-alert" role="alert" data-testid="status-error">{error}</p>}
            <div className="sc-stage-actions">
              <span className={`sc-minimum ${ingredients.length >= 3 ? "is-ready" : ""}`} data-testid="status-minimum-ingredients">
                {ingredients.length >= 3 ? <Check size={15} /> : <span className="sc-minimum-dot" />}
                {ingredients.length >= 3 ? "You’re ready for the next step" : `${Math.max(0, 3 - ingredients.length)} more to go`}
              </span>
              <button
                className="sc-button sc-button-primary"
                type="button"
                disabled={ingredients.length < 3 || loading}
                onClick={saveIngredientsAndContinue}
                data-testid="button-next-preferences"
              >
                {saveSession.isPending ? <LoaderCircle className="sc-spin" size={17} /> : null}
                Next: Preferences <ArrowRight size={17} />
              </button>
            </div>
          </section>
        )}

        {step === "preferences" && (
          <section className="sc-stage" aria-labelledby="page-title-preferences">
            <div className="sc-stage-heading">
              <div className="sc-eyebrow"><ChefHat size={14} /> SET THE TABLE YOUR WAY</div>
              <h1 id="page-title-preferences">How do you want to <em>cook?</em></h1>
              <p>A few quick choices help us find recipes that fit your day.</p>
            </div>
            <div className="sc-fridge-summary">
              <span className="sc-summary-label"><CookingPot size={15} /> YOUR FRIDGE</span>
              <div className="sc-summary-ingredients">
                {ingredients.slice(0, 6).map((ingredient) => <span key={ingredient}>{ingredient}</span>)}
                {ingredients.length > 6 && <span className="sc-summary-more">+{ingredients.length - 6} more</span>}
              </div>
              <button type="button" onClick={goToIngredients} className="sc-text-button" data-testid="button-edit-ingredients">Edit</button>
            </div>
            <PreferencesCard preferences={preferences} setPreferences={setPreferences} />
            {error && <p className="sc-alert" role="alert" data-testid="status-error">{error}</p>}
            <div className="sc-stage-actions sc-stage-actions-between">
              <button type="button" className="sc-back-button" onClick={goToIngredients} data-testid="button-back-ingredients">
                <ArrowLeft size={16} /> Back
              </button>
              <button
                className="sc-button sc-button-primary"
                type="button"
                disabled={loading || preferences.equipment.length === 0}
                onClick={savePreferencesAndGenerate}
                data-testid="button-generate-recipes"
              >
                {loading ? <LoaderCircle className="sc-spin" size={17} /> : <Sparkles size={16} />}
                Find Recipes
              </button>
            </div>
            {loading && (
              <div className="sc-checking" role="status" data-testid="status-checking-fridge">
                <span className="sc-checking-spinner"><LoaderCircle className="sc-spin" size={18} /></span>
                <span>Checking your fridge…</span>
                <span className="sc-checking-sub">Generating up to 10 recipes from your ingredients.</span>
              </div>
            )}
          </section>
        )}

        {step === "results" && (
          <section className="sc-stage" aria-labelledby="page-title-results">
            <div className="sc-stage-heading sc-results-heading">
              <div className="sc-eyebrow"><Sparkles size={14} /> MADE FOR YOUR KITCHEN</div>
              <h1 id="page-title-results">A little fridge <em>inspiration.</em></h1>
              <p>Recipe ideas matched to your ingredients and preferences.</p>
            </div>
            {sessionQuery.data?.demoMode && (
              <div className="sc-demo-note" data-testid="status-demo-mode">
                <span><Sparkles size={15} /> Demo recipes</span>
                <span>Add API keys in Settings to generate recipes.</span>
              </div>
            )}
            {error && <p className="sc-alert" role="alert" data-testid="status-error">{error}</p>}
            <div className="sc-results-topline">
              <div><span className="sc-results-count" data-testid="text-recipe-result-count">{recipes.length}</span><span>recipes, picked for you</span></div>
              <button type="button" className="sc-text-button" onClick={regenerate} disabled={loading} data-testid="button-refresh-recipes">
                <Sparkles size={14} /> Find another set
              </button>
            </div>
            {loading ? (
              <div className="sc-results-loading" role="status" data-testid="status-checking-fridge">
                <span className="sc-checking-spinner"><LoaderCircle className="sc-spin" size={19} /></span>
                <strong>Checking your fridge…</strong>
                <span>Searching for recipes that fit your filters.</span>
              </div>
            ) : recipes.length > 0 ? (
              <div className="sc-recipe-grid">
                {recipes.map((recipe, index) => <RecipeCard recipe={recipe} index={index} snackMode={snackMode || recipe.id.startsWith("generated-snack-")} showNutrition={showNutrition} key={recipe.id} />)}
              </div>
            ) : (
              <div className="sc-empty-results">
                <span className="sc-empty-icon"><CookingPot size={21} /></span>
                <strong>No recipes matched</strong>
                <span>Try a longer time limit, another diet, or a few more ingredients.</span>
              </div>
            )}
            <div className="sc-results-bottom">
              <button type="button" className="sc-back-button" onClick={() => setStep("preferences")} data-testid="button-edit-preferences">
                <ArrowLeft size={16} /> Change preferences
              </button>
              <button type="button" className="sc-text-button" onClick={goToIngredients} data-testid="button-change-ingredients">Change ingredients</button>
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}