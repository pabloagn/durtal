import {
  pgTable,
  uuid,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { authorContributionTypes } from "./authors";

export const contributionTypes = pgTable("contribution_types", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  applicableWorkTypes: text("applicable_work_types"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contributionTypesRelations = relations(contributionTypes, ({ many }) => ({
  authorContributionTypes: many(authorContributionTypes),
}));
