import { useEffect, useState } from "react";
import { useShowNutrition } from "@/hooks/use-show-nutrition";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock3,
  CookingPot,
  ExternalLink,
  LoaderCircle,
  Share2,
  TrendingUp,
  Users,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetScrapCookRecipeQueryKey,
  getGetScrapCookSessionQueryKey,
  useGetScrapCookRecipe,
  useMarkScrapCookRecipeMade,
} from "@workspace/api-client-react";
import { Link, useLocation, useRoute } from "wouter";
import type { RecipeDetail } from "@workspace/api-client-react";
import CookedMealDialog from "@/components/cooked-meal-dialog";

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return fallback;
}

function Header() {
  return (
    <header className="sc-header">
      <Link className="sc-brand" href="/" aria-label="ScrapCook home" data-testid="link-scrapcook-home">
        <span className="sc-brand-mark"><CookingPot size={19} strokeWidth={2.3} /></span>
        <span>scrap<span>cook</span></span>
      </Link>
      <div className="sc-header-note">
        <span>Good food. Less waste.</span>
      </div>
      <nav className="sc-header-links" aria-label="Your ScrapCook">
        <Link href="/savings" className="sc-nav-link"><TrendingUp size={15} /> Savings</Link>
        <Link href="/settings" className="sc-nav-link">Settings</Link>
      </nav>
    </header>
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

function RecipeContent({
  recipe,
  recipeId,
}: {
  recipe: RecipeDetail;
  recipeId: string;
}) {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const markMade = useMarkScrapCookRecipeMade();
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [shareMessage, setShareMessage] = useState("");
  const remainingMissing = recipe.ingredients.reduce(
    (count, ingredient, index) => count + ((checked[index] ?? ingredient.inFridge) ? 0 : 1),
    0,
  );

  useEffect(() => {
    setChecked(Object.fromEntries(recipe.ingredients.map((item, index) => [index, item.inFridge])));
  }, [recipe.id]);

  const toggleIngredient = (index: number, initialValue: boolean) => {
    setChecked((current) => ({ ...current, [index]: !(current[index] ?? initialValue) }));
  };

  const handleMade = () => {
    markMade.mutate(
      { recipeId },
      {
        onSuccess: () => {
          queryClient.setQueryData<RecipeDetail>(
            getGetScrapCookRecipeQueryKey(recipeId),
            (current) => current ? { ...current, made: true } : current,
          );
          void queryClient.invalidateQueries({ queryKey: getGetScrapCookSessionQueryKey() });
        },
      },
    );
  };

  const handleShare = async () => {
    const shareUrl = window.location.href;
    const shareData = {
      title: recipe.title,
      text: `I found this recipe on ScrapCook: ${recipe.title}`,
      url: shareUrl,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setShareMessage("Recipe link copied");
        window.setTimeout(() => setShareMessage(""), 2400);
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        setShareMessage("Could not share this recipe from your browser.");
        window.setTimeout(() => setShareMessage(""), 2800);
      }
    }
  };

  return (
    <div className="sc-app">
      <Header />
      <main className="sc-page sc-recipe-page">
        <button type="button" className="sc-back-button sc-detail-back" onClick={() => setLocation("/")} data-testid="button-back-recipes">
          <ArrowLeft size={16} /> Back to recipes
        </button>
        <article className="sc-recipe-detail">
          <div className="sc-detail-photo">
            <img
              src={recipe.image}
              alt={`Photo of ${recipe.title}`}
              onError={(event) => { event.currentTarget.style.visibility = "hidden"; }}
              data-testid={`img-recipe-detail-${recipe.id}`}
            />
            <span className="sc-detail-photo-label"><CookingPot size={14} /> A ScrapCook recipe</span>
          </div>
          <div className="sc-detail-main">
            <div className="sc-eyebrow"><span className="sc-kicker-dot" /> YOUR NEXT GOOD MEAL</div>
            <h1 className="sc-detail-title" data-testid="text-recipe-detail-title">{recipe.title}</h1>
            <div className="sc-detail-facts">
              <span><Clock3 size={16} /> {recipe.readyInMinutes} minutes</span>
              <span><Users size={16} /> Serves {recipe.servings}</span>
              <span className="sc-difficulty-pill"><CheckCircle2 size={14} /> {recipe.difficulty}</span>
            </div>
            {remainingMissing > 0 ? (
              <div className="sc-detail-missing" data-testid="text-detail-missing">
                <span className="sc-detail-missing-dot" />
                {remainingMissing} ingredient{remainingMissing === 1 ? "" : "s"} to pick up
              </div>
            ) : (
              <div className="sc-detail-ready" data-testid="text-detail-ready">
                <CheckCircle2 size={15} /> You have everything for this one
              </div>
            )}

            <div className="sc-detail-columns">
              <section className="sc-detail-section" aria-labelledby="ingredients-heading">
                <div className="sc-section-heading">
                  <span className="sc-section-number">01</span>
                  <div>
                    <h2 id="ingredients-heading">Ingredients</h2>
                    <p>Check things off as you go</p>
                  </div>
                </div>
                <ul className="sc-ingredient-list">
                  {recipe.ingredients.map((ingredient, index) => {
                    const isChecked = checked[index] ?? ingredient.inFridge;
                    return (
                      <li className={`sc-detail-ingredient ${isChecked ? "is-checked" : "is-missing"}`} key={`${ingredient.name}-${index}`} data-testid={`row-recipe-ingredient-${index}`}>
                        <button
                          type="button"
                          className="sc-checkbox"
                          onClick={() => toggleIngredient(index, ingredient.inFridge)}
                          aria-label={`${isChecked ? "Uncheck" : "Check"} ${ingredient.original}`}
                          aria-pressed={isChecked}
                          data-testid={`button-check-ingredient-${index}`}
                        >
                          {isChecked && <Check size={13} />}
                        </button>
                        <span className="sc-ingredient-name">
                          <strong>{ingredient.original || ingredient.name}</strong>
                          <small>{ingredient.inFridge ? (isChecked ? "In your fridge" : "Unchecked") : (isChecked ? "Checked off" : "Not in your fridge")}</small>
                        </span>
                        {!isChecked && !ingredient.inFridge && <span className="sc-missing-mark">Get</span>}
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="sc-detail-section sc-instructions-section" aria-labelledby="instructions-heading">
                <div className="sc-section-heading">
                  <span className="sc-section-number sc-section-orange">02</span>
                  <div>
                    <h2 id="instructions-heading">Let’s make it</h2>
                    <p>{recipe.instructionsSimplified ? "Detailed beginner-friendly steps" : "Recipe instructions"}</p>
                  </div>
                </div>
                {(recipe.instructionsSimplified || recipe.instructionsNote) && (
                  <p
                    className={`sc-instruction-note ${recipe.instructionsSimplified ? "is-simplified" : ""}`}
                    role="status"
                    data-testid="status-instruction-simplification"
                  >
                    {recipe.instructionsNote
                      ?? "Detailed steps expanded by Gemini, including measurements, timings, and beginner tips."}
                  </p>
                )}
                <ol className="sc-instructions-list">
                  {recipe.instructions.map((instruction, index) => (
                    <li key={`${index}-${instruction.slice(0, 18)}`} data-testid={`text-instruction-step-${index + 1}`}>
                      <span className="sc-instruction-number">{String(index + 1).padStart(2, "0")}</span>
                      <p>{instruction}</p>
                    </li>
                  ))}
                </ol>
              </section>
            </div>

            <div className="sc-detail-actions">
              <CookedMealDialog
                recipeId={recipe.id}
                recipeName={recipe.title}
                triggerClassName="sc-button sc-button-primary sc-cooked-detail-button"
                triggerLabel="I Cooked This!"
              />
              <button
                type="button"
                className={`sc-button sc-button-primary sc-made-button ${recipe.made ? "is-made" : ""}`}
                onClick={handleMade}
                disabled={recipe.made || markMade.isPending}
                data-testid="button-mark-recipe-made"
              >
                {markMade.isPending ? <LoaderCircle className="sc-spin" size={17} /> : <CheckCircle2 size={17} />}
                {recipe.made ? "Made — nice work!" : "I Made This!"}
              </button>
              <button type="button" className="sc-button sc-button-outline" onClick={handleShare} data-testid="button-share-recipe">
                <Share2 size={16} /> Share <ExternalLink size={13} className="sc-share-external" />
              </button>
            </div>
            {markMade.isError && (
              <p className="sc-alert sc-detail-error" role="alert" data-testid="status-made-error">
                {errorMessage(markMade.error, "We couldn't mark this recipe as made. Please try again.")}
              </p>
            )}
            {shareMessage && <p className="sc-share-message" role="status" data-testid="status-share-message">{shareMessage}</p>}
          </div>
        </article>
      </main>
      <Footer />
    </div>
  );
}

export default function RecipePage() {
  const [showNutrition] = useShowNutrition();
  const [match, params] = useRoute<{ recipeId: string }>("/recipe/:recipeId");
  const recipeId = match ? decodeURIComponent(params.recipeId) : "";
  const recipeQuery = useGetScrapCookRecipe(recipeId, {
    request: { headers: { "X-Show-Nutrition": String(showNutrition) } },
    query: {
      enabled: Boolean(recipeId),
      queryKey: getGetScrapCookRecipeQueryKey(recipeId),
    },
  });

  if (recipeQuery.isLoading) {
    return (
      <div className="sc-app">
        <Header />
        <main className="sc-page sc-loading-page">
          <div className="sc-loader-mark"><CookingPot size={22} /></div>
          <p>Getting your recipe ready…</p>
        </main>
        <Footer />
      </div>
    );
  }

  if (recipeQuery.isError || !recipeQuery.data) {
    return (
      <div className="sc-app">
        <Header />
        <main className="sc-page sc-loading-page">
          <h1>We couldn't find this recipe.</h1>
          <p>This recipe may have expired from your cooking session.</p>
          <Link href="/" className="sc-button sc-button-primary" data-testid="link-back-to-scrapcook">
            <ArrowLeft size={16} /> Back to ScrapCook
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  return <RecipeContent recipe={recipeQuery.data} recipeId={recipeId} />;
}