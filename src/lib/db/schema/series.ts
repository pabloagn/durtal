import { pgTable, uuid, text, smallint, boolean, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { works } from "./works";

export const series = pgTable("series", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  originalTitle: text("original_title"),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  totalVolumes: smallint("total_volumes"),
  isComplete: boolean("is_complete").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const seriesRelations = relations(series, ({ many }) => ({
  works: many(works),
}));
