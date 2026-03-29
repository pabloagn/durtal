import { pgTable, uuid, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { works } from "./works";

export const recommenders = pgTable("recommenders", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  url: text("url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const recommendersRelations = relations(recommenders, ({ many }) => ({
  workRecommenders: many(workRecommenders),
}));

export const workRecommenders = pgTable(
  "work_recommenders",
  {
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    recommenderId: uuid("recommender_id")
      .notNull()
      .references(() => recommenders.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.workId, t.recommenderId] })],
);

export const workRecommendersRelations = relations(workRecommenders, ({ one }) => ({
  work: one(works, {
    fields: [workRecommenders.workId],
    references: [works.id],
  }),
  recommender: one(recommenders, {
    fields: [workRecommenders.recommenderId],
    references: [recommenders.id],
  }),
}));
