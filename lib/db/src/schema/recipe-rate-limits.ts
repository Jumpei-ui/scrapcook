import { date, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const recipeRateLimitsTable = pgTable("recipe_rate_limits", {
  clientHash: text("client_hash").primaryKey(),
  requestTimes: timestamp("request_times", { withTimezone: true }).array().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRecipeRateLimitSchema = createInsertSchema(recipeRateLimitsTable);
export type InsertRecipeRateLimit = z.infer<typeof insertRecipeRateLimitSchema>;
export type RecipeRateLimit = typeof recipeRateLimitsTable.$inferSelect;

export const recipeDailyUsageTable = pgTable("recipe_daily_usage", {
  usageDay: date("usage_day", { mode: "string" }).primaryKey(),
  used: integer("used").notNull(),
});

export const insertRecipeDailyUsageSchema = createInsertSchema(recipeDailyUsageTable);
export type InsertRecipeDailyUsage = z.infer<typeof insertRecipeDailyUsageSchema>;
export type RecipeDailyUsage = typeof recipeDailyUsageTable.$inferSelect;
