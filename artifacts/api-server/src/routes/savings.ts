import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { db, mealsCookedTable, scrapCookSettingsTable } from "@workspace/db";
import {
  CreateScrapCookMealBody,
  CreateScrapCookMealResponse,
  EstimateScrapCookRecipeCostBody,
  EstimateScrapCookRecipeCostResponse,
  GetScrapCookSavingsDashboardResponse,
  UpdateScrapCookSavingsSettingsBody,
  UpdateScrapCookSavingsSettingsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const pythonPort = Number(process.env.SCRAPCOOK_PY_PORT ?? 5087);
const userCookieName = "scrapcook_user_id";
const anonymousCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 365 * 24 * 60 * 60 * 1000,
  path: "/api/scrapcook",
  signed: true,
};

const priceReferences: {
  matches: string[];
  perGram?: number;
  perMl?: number;
  perEach?: number;
  perTablespoon?: number;
  perTeaspoon?: number;
  perCup?: number;
  perSlice?: number;
  perClove?: number;
  perHandful?: number;
}[] = [
  { matches: ["chicken", "beef", "pork", "fish", "salmon"], perGram: 0.018, perEach: 3.5 },
  { matches: ["egg"], perEach: 0.65, perGram: 0.01 },
  { matches: ["pasta", "noodle"], perGram: 0.006, perCup: 0.8 },
  { matches: ["rice"], perGram: 0.0045, perCup: 0.55 },
  { matches: ["tomato"], perGram: 0.005, perEach: 0.8 },
  { matches: ["garlic"], perGram: 0.012, perEach: 0.12, perClove: 0.12 },
  { matches: ["olive oil", "oil"], perMl: 0.016, perTablespoon: 0.24, perTeaspoon: 0.08 },
  { matches: ["basil", "parsley", "coriander", "herb"], perGram: 0.035, perEach: 0.05, perHandful: 0.5 },
  { matches: ["cheese", "parmesan"], perGram: 0.025, perCup: 2.5, perTablespoon: 0.25 },
  { matches: ["bread", "toast"], perGram: 0.006, perEach: 0.33, perSlice: 0.33 },
  { matches: ["potato"], perGram: 0.0045, perEach: 0.75 },
  { matches: ["onion"], perGram: 0.004, perEach: 0.8 },
  { matches: ["milk"], perMl: 0.002, perCup: 0.5 },
  { matches: ["butter"], perGram: 0.012, perTablespoon: 0.22, perTeaspoon: 0.08 },
  { matches: ["carrot"], perGram: 0.004, perEach: 0.5 },
  { matches: ["spinach"], perGram: 0.012, perHandful: 0.7 },
  { matches: ["mushroom"], perGram: 0.012, perEach: 0.2 },
  { matches: ["bean", "lentil", "chickpea"], perGram: 0.005, perCup: 0.65 },
  { matches: ["lemon", "lime"], perEach: 0.85 },
  { matches: ["yogurt", " yoghurt"], perGram: 0.009, perCup: 1.5 },
  { matches: ["tuna"], perGram: 0.012, perEach: 2.2 },
];

function getAnonymousUserId(req: Parameters<Parameters<IRouter["get"]>[1]>[0], res: Parameters<Parameters<IRouter["get"]>[1]>[1]) {
  const existing = req.signedCookies?.[userCookieName];
  if (typeof existing === "string" && /^[0-9a-f-]{36}$/i.test(existing)) {
    return existing;
  }

  const userId = randomUUID();
  res.cookie(userCookieName, userId, anonymousCookieOptions);
  return userId;
}

function numeric(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundedMoney(value: number): number {
  return Math.round(Math.max(0, value) * 100) / 100;
}

function ingredientEstimate(ingredient: {
  name?: unknown;
  amount?: unknown;
  unit?: unknown;
}): number {
  const name = String(ingredient.name ?? "").toLowerCase();
  const unit = String(ingredient.unit ?? "").toLowerCase().trim();
  const amount = Math.max(0, numeric(ingredient.amount, 1));
  const rule = priceReferences.find((candidate) =>
    candidate.matches.some((match) => name.includes(match)),
  );

  if (rule) {
    if (/^(g|gram|grams)$/.test(unit) && rule.perGram !== undefined) return amount * rule.perGram;
    if (/^(kg|kilogram|kilograms)$/.test(unit) && rule.perGram !== undefined) return amount * 1000 * rule.perGram;
    if (/^(ml|milliliter|milliliters)$/.test(unit) && rule.perMl !== undefined) return amount * rule.perMl;
    if (/^(l|liter|liters)$/.test(unit) && rule.perMl !== undefined) return amount * 1000 * rule.perMl;
    if (/^(tbsp|tablespoon|tablespoons)$/.test(unit) && rule.perTablespoon !== undefined) return amount * rule.perTablespoon;
    if (/^(tsp|teaspoon|teaspoons)$/.test(unit) && rule.perTeaspoon !== undefined) return amount * rule.perTeaspoon;
    if (/^(cup|cups)$/.test(unit) && rule.perCup !== undefined) return amount * rule.perCup;
    if (/^(slice|slices)$/.test(unit) && rule.perSlice !== undefined) return amount * rule.perSlice;
    if (/^(clove|cloves)$/.test(unit) && rule.perClove !== undefined) return amount * rule.perClove;
    if (/^(handful|handfuls)$/.test(unit) && rule.perHandful !== undefined) return amount * rule.perHandful;
    if (rule.perEach !== undefined) return amount * rule.perEach;
  }

  if (/^(g|gram|grams)$/.test(unit)) return amount * 0.006;
  if (/^(kg|kilogram|kilograms)$/.test(unit)) return amount * 6;
  if (/^(ml|milliliter|milliliters)$/.test(unit)) return amount * 0.003;
  if (/^(l|liter|liters)$/.test(unit)) return amount * 3;
  if (/^(tsp|teaspoon|teaspoons)$/.test(unit)) return amount * 0.08;
  if (/^(tbsp|tablespoon|tablespoons)$/.test(unit)) return amount * 0.2;
  if (/^(cup|cups)$/.test(unit)) return amount * 0.8;
  return Math.min(5, Math.max(0.25, amount) * 0.45);
}

async function loadRecipeDetails(recipeId: string, cookie: string | undefined) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", cookie);
  const upstream = await fetch(
    `http://127.0.0.1:${pythonPort}/api/scrapcook/recipes/${encodeURIComponent(recipeId)}`,
    { headers, signal: AbortSignal.timeout(20_000) },
  );
  if (!upstream.ok) {
    return { response: upstream, recipe: null };
  }
  return { response: upstream, recipe: (await upstream.json()) as {
    id?: string;
    title?: string;
    servings?: number;
    ingredients?: { name?: unknown; amount?: unknown; unit?: unknown }[];
  } };
}

async function ensureSettings(userId: string) {
  await db
    .insert(scrapCookSettingsTable)
    .values({ userId })
    .onConflictDoNothing({ target: scrapCookSettingsTable.userId });
  const [settings] = await db
    .select()
    .from(scrapCookSettingsTable)
    .where(eq(scrapCookSettingsTable.userId, userId))
    .limit(1);
  return settings;
}

router.get("/dashboard", async (req, res): Promise<void> => {
  try {
    const userId = getAnonymousUserId(req, res);
    const settings = await ensureSettings(userId);
    const [totals] = await db
      .select({
        todaySavings: sql<number>`COALESCE(SUM(${mealsCookedTable.amountSaved}) FILTER (WHERE (${mealsCookedTable.createdAt} AT TIME ZONE 'Australia/Brisbane')::date = (NOW() AT TIME ZONE 'Australia/Brisbane')::date), 0)::float8`,
        weekSavings: sql<number>`COALESCE(SUM(${mealsCookedTable.amountSaved}) FILTER (WHERE ${mealsCookedTable.createdAt} >= NOW() - INTERVAL '7 days'), 0)::float8`,
        monthSavings: sql<number>`COALESCE(SUM(${mealsCookedTable.amountSaved}) FILTER (WHERE (${mealsCookedTable.createdAt} AT TIME ZONE 'Australia/Brisbane')::date >= date_trunc('month', NOW() AT TIME ZONE 'Australia/Brisbane')::date), 0)::float8`,
        yearSavings: sql<number>`COALESCE(SUM(${mealsCookedTable.amountSaved}) FILTER (WHERE (${mealsCookedTable.createdAt} AT TIME ZONE 'Australia/Brisbane')::date >= date_trunc('year', NOW() AT TIME ZONE 'Australia/Brisbane')::date), 0)::float8`,
      })
      .from(mealsCookedTable)
      .where(eq(mealsCookedTable.userId, userId));

    const dailyResult = await db.execute(sql`
      WITH days AS (
        SELECT generate_series(
          ((NOW() AT TIME ZONE 'Australia/Brisbane')::date - 6)::timestamp,
          (NOW() AT TIME ZONE 'Australia/Brisbane')::date::timestamp,
          INTERVAL '1 day'
        )::date AS local_date
      )
      SELECT
        to_char(days.local_date, 'YYYY-MM-DD') AS date,
        COALESCE(SUM(meals_cooked.amount_saved), 0)::float8 AS "amountSaved"
      FROM days
      LEFT JOIN meals_cooked
        ON meals_cooked.user_id = ${userId}
        AND (meals_cooked.created_at AT TIME ZONE 'Australia/Brisbane')::date = days.local_date
      GROUP BY days.local_date
      ORDER BY days.local_date
    `);

    const recentMeals = await db
      .select({
        id: mealsCookedTable.id,
        createdAt: mealsCookedTable.createdAt,
        recipeName: mealsCookedTable.recipeName,
        actualCost: mealsCookedTable.actualCost,
        comparedToLabel: mealsCookedTable.comparedToLabel,
        comparedToCost: mealsCookedTable.comparedToCost,
        amountSaved: mealsCookedTable.amountSaved,
      })
      .from(mealsCookedTable)
      .where(eq(mealsCookedTable.userId, userId))
      .orderBy(desc(mealsCookedTable.createdAt))
      .limit(12);

    const rows = dailyResult.rows as { date: string; amountSaved: number | string }[];
    const response = {
      todaySavings: numeric(totals?.todaySavings),
      weekSavings: numeric(totals?.weekSavings),
      monthSavings: numeric(totals?.monthSavings),
      yearSavings: numeric(totals?.yearSavings),
      dailySavings: rows.map((row) => ({
        date: row.date,
        amountSaved: numeric(row.amountSaved),
      })),
      recentMeals,
      defaultComparison: {
        label: settings?.defaultComparisonLabel ?? "Takeaway",
        cost: settings?.defaultComparisonCost ?? 18.5,
      },
    };

    if (!GetScrapCookSavingsDashboardResponse.safeParse(response).success) {
      req.log.error("Savings dashboard response failed schema validation");
      res.status(500).json({ error: "Could not load savings data." });
      return;
    }
    res.json(response);
  } catch (error) {
    req.log.error({ err: error }, "Could not load ScrapCook savings dashboard");
    res.status(500).json({ error: "Could not load savings data." });
  }
});

router.post("/estimate", async (req, res): Promise<void> => {
  const parsed = EstimateScrapCookRecipeCostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a valid recipe to estimate." });
    return;
  }

  try {
    getAnonymousUserId(req, res);
    const { response: upstream, recipe } = await loadRecipeDetails(
      parsed.data.recipeId,
      req.header("cookie"),
    );
    if (!recipe) {
      res.status(upstream.status === 404 ? 404 : 502).json({
        error: upstream.status === 404
          ? "This recipe is no longer in your cooking session."
          : "Could not load recipe ingredients for an estimate.",
      });
      return;
    }

    const ingredients = recipe.ingredients ?? [];
    if (!ingredients.length) {
      res.status(502).json({ error: "This recipe has no ingredient details to estimate." });
      return;
    }
    const servings = Math.max(1, numeric(recipe.servings, 1));
    const total = ingredients.reduce((sum, ingredient) => sum + ingredientEstimate(ingredient), 0);
    const estimate = {
      estimatedCostPerServe: roundedMoney(total / servings),
      estimateType: "reference" as const,
      note: "Rough estimate using typical Australian grocery prices. Edit it to match what you actually spent.",
    };
    res.json(EstimateScrapCookRecipeCostResponse.parse(estimate));
  } catch (error) {
    req.log.error({ err: error }, "Could not estimate ScrapCook recipe cost");
    res.status(502).json({ error: "Could not estimate this recipe cost just now." });
  }
});

router.post("/meals", async (req, res): Promise<void> => {
  const parsed = CreateScrapCookMealBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the recipe name and meal costs, then try again." });
    return;
  }

  try {
    const userId = getAnonymousUserId(req, res);
    const [meal] = await db
      .insert(mealsCookedTable)
      .values({
        userId,
        recipeName: parsed.data.recipeName.trim(),
        actualCost: roundedMoney(parsed.data.actualCost),
        comparedToLabel: parsed.data.comparedToLabel,
        comparedToCost: roundedMoney(parsed.data.comparedToCost),
      })
      .returning({
        id: mealsCookedTable.id,
        createdAt: mealsCookedTable.createdAt,
        recipeName: mealsCookedTable.recipeName,
        actualCost: mealsCookedTable.actualCost,
        comparedToLabel: mealsCookedTable.comparedToLabel,
        comparedToCost: mealsCookedTable.comparedToCost,
        amountSaved: mealsCookedTable.amountSaved,
      });
    res.status(201).json(CreateScrapCookMealResponse.parse(meal));
  } catch (error) {
    req.log.error({ err: error }, "Could not save cooked meal");
    res.status(500).json({ error: "Could not save this meal. Please try again." });
  }
});

router.put("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateScrapCookSavingsSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a comparison and enter a valid cost." });
    return;
  }

  try {
    const userId = getAnonymousUserId(req, res);
    const [settings] = await db
      .insert(scrapCookSettingsTable)
      .values({
        userId,
        defaultComparisonLabel: parsed.data.label,
        defaultComparisonCost: roundedMoney(parsed.data.cost),
      })
      .onConflictDoUpdate({
        target: scrapCookSettingsTable.userId,
        set: {
          defaultComparisonLabel: parsed.data.label,
          defaultComparisonCost: roundedMoney(parsed.data.cost),
          updatedAt: new Date(),
        },
      })
      .returning({
        label: scrapCookSettingsTable.defaultComparisonLabel,
        cost: scrapCookSettingsTable.defaultComparisonCost,
      });
    res.json(UpdateScrapCookSavingsSettingsResponse.parse(settings));
  } catch (error) {
    req.log.error({ err: error }, "Could not save ScrapCook comparison preference");
    res.status(500).json({ error: "Could not save your default comparison." });
  }
});

export default router;