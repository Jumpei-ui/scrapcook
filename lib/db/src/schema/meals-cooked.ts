import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import {
  index,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const mealsCookedTable = pgTable(
  "meals_cooked",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    recipeName: text("recipe_name").notNull(),
    actualCost: numeric("actual_cost", {
      precision: 10,
      scale: 2,
      mode: "number",
    }).notNull(),
    comparedToLabel: text("compared_to_label").notNull(),
    comparedToCost: numeric("compared_to_cost", {
      precision: 10,
      scale: 2,
      mode: "number",
    }).notNull(),
    amountSaved: numeric("amount_saved", {
      precision: 10,
      scale: 2,
      mode: "number",
    })
      .generatedAlwaysAs(sql`compared_to_cost - actual_cost`)
      .notNull(),
  },
  (table) => [index("meals_cooked_user_created_idx").on(table.userId, table.createdAt)],
);

export const insertMealCookedSchema = createInsertSchema(mealsCookedTable).omit({
  id: true,
  createdAt: true,
});

export type InsertMealCooked = typeof mealsCookedTable.$inferInsert;
export type MealCooked = typeof mealsCookedTable.$inferSelect;