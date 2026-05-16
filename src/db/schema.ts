import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const customers = pgTable("customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerNo: text("customer_no").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  customerType: text("customer_type").notNull(),
  customerTypeDetail: text("customer_type_detail").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const consultations = pgTable("consultations", {
  id: uuid("id").defaultRandom().primaryKey(),
  consultationNo: text("consultation_no").notNull().unique(),
  customerId: uuid("customer_id").references(() => customers.id),
  statusGroup: text("status_group").notNull(),
  status: text("status").notNull(),
  source: text("source").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
