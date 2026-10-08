import { date, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const recipeUsageTable = pgTable("scrapcook_recipe_usage", {
  usageDate: date("usage_date", { mode: "string" }).primaryKey(),
  spoon: integer("spoon").notNull().default(0),
  gemini: integer("gemini").notNull().default(0),
  totalRequests: integer("total_requests").notNull().default(0),
  recentRequests: jsonb("recent_requests")
    .$type<{ ip: string; timestamp: string }[]>()
    .notNull()
    .default([]),
});

export type RecipeUsage = typeof recipeUsageTable.$inferSelect;

export const recipeAdminAttemptsTable = pgTable("scrapcook_admin_attempts", {
  clientHash: text("client_hash").primaryKey(),
  requestTimes: timestamp("request_times", { withTimezone: true }).array().notNull(),
});
