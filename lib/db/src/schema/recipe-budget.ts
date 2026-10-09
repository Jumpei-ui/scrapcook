import { boolean, date, integer, pgTable, timestamp } from "drizzle-orm/pg-core";

export const recipeProviderBudgetTable = pgTable("scrapcook_provider_budget", {
  usageDate: date("usage_date", { mode: "string" }).primaryKey(),
  spoonCalls: integer("spoon_calls").notNull().default(0),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  forceResumed: boolean("force_resumed").notNull().default(false),
});
