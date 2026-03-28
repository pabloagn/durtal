import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { works } from "./works";

export const keywords = pgTable("keywords", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const keywordsRelations = relations(keywords, ({ many }) => ({
  workKeywords: many(workKeywords),
}));

export const workKeywords = pgTable(
  "work_keywords",
  {
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    keywordId: uuid("keyword_id")
      .notNull()
      .references(() => keywords.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.workId, t.keywordId] })],
);

export const workKeywordsRelations = relations(workKeywords, ({ one }) => ({
  work: one(works, {
    fields: [workKeywords.workId],
    references: [works.id],
  }),
  keyword: one(keywords, {
    fields: [workKeywords.keywordId],
    references: [keywords.id],
  }),
}));
