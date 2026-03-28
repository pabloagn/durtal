import { pgTable, uuid, text, smallint } from "drizzle-orm/pg-core";

export const centuries = pgTable("centuries", {
  id: uuid("id").defaultRandom().primaryKey(),
  label: text("label").notNull().unique(),
  startYear: smallint("start_year").notNull(),
  endYear: smallint("end_year").notNull(),
  sortOrder: smallint("sort_order").notNull(),
});
