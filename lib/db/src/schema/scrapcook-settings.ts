import { createInsertSchema } from "drizzle-zod";
import { pgTable, numeric, text, timestamp } from "drizzle-orm/pg-core";

export const scrapCookSettingsTable = pgTable("scrapcook_settings", {
  userId: text("user_id").primaryKey(),
  defaultComparisonLabel: text("default_comparison_label")
    .notNull()
    .default("Takeaway"),
  defaultComparisonCost: numeric("default_comparison_cost", {
    precision: 10,
    scale: 2,
    mode: "number",
  })
    .notNull()
    .default(18.5),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertScrapCookSettingsSchema = createInsertSchema(
  scrapCookSettingsTable,
).omit({ createdAt: true, updatedAt: true });

export type InsertScrapCookSettings = typeof scrapCookSettingsTable.$inferInsert;
export type ScrapCookSettings = typeof scrapCookSettingsTable.$inferSelect;