import { pgTable, uuid, text, smallint, timestamp } from "drizzle-orm/pg-core";

export const countries = pgTable("countries", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  alpha2: text("alpha_2").notNull().unique(),
  alpha3: text("alpha_3").notNull().unique(),
  numericCode: smallint("numeric_code"),
  continentName: text("continent_name"),
  continentCode: text("continent_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
