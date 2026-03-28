import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const sources = pgTable("sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  url: text("url"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
