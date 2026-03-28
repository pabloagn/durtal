import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const workTypes = pgTable("work_types", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
