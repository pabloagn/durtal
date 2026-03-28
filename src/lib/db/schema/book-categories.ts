import {
  pgTable,
  uuid,
  text,
  smallint,
  integer,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { works } from "./works";

export const bookCategories = pgTable("book_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  level: smallint("level").notNull(),
  parentId: uuid("parent_id").references((): any => bookCategories.id, {
    onDelete: "cascade",
  }),
  scopeNotes: text("scope_notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bookCategoriesRelations = relations(bookCategories, ({ one, many }) => ({
  parent: one(bookCategories, {
    fields: [bookCategories.parentId],
    references: [bookCategories.id],
    relationName: "categoryHierarchy",
  }),
  children: many(bookCategories, { relationName: "categoryHierarchy" }),
  workCategories: many(workCategories),
}));

export const workCategories = pgTable(
  "work_categories",
  {
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => bookCategories.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.workId, t.categoryId] })],
);

export const workCategoriesRelations = relations(workCategories, ({ one }) => ({
  work: one(works, {
    fields: [workCategories.workId],
    references: [works.id],
  }),
  category: one(bookCategories, {
    fields: [workCategories.categoryId],
    references: [bookCategories.id],
  }),
}));
