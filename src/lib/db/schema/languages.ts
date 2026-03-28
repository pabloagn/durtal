import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const languages = pgTable("languages", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  iso6391: text("iso_639_1").unique(),
  iso6392: text("iso_639_2"),
  iso6393: text("iso_639_3"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
