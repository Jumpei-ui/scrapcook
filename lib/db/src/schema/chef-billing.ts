import { pgTable, text, date, integer, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
export const chefCustomersTable = pgTable("chef_customers", {
  userId: text("user_id").primaryKey(), customerId: text("customer_id").notNull().unique(),
});
export const chefFreeUsageTable = pgTable("chef_free_usage", {
  clientHash: text("client_hash").notNull(), usageDay: date("usage_day", { mode: "string" }).notNull(),
  used: integer("used").notNull(),
}, table => [primaryKey({ columns: [table.clientHash, table.usageDay] })]);
export const insertChefCustomerSchema = createInsertSchema(chefCustomersTable);
export const insertChefFreeUsageSchema = createInsertSchema(chefFreeUsageTable);
export type ChefCustomer = z.infer<typeof insertChefCustomerSchema>;
export type ChefFreeUsage = z.infer<typeof insertChefFreeUsageSchema>;
