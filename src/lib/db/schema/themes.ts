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

export const themes = pgTable("themes", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  level: smallint("level").notNull(),
  parentId: uuid("parent_id").references((): any => themes.id, {
    onDelete: "cascade",
  }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const themesRelations = relations(themes, ({ one, many }) => ({
  parent: one(themes, {
    fields: [themes.parentId],
    references: [themes.id],
    relationName: "themeHierarchy",
  }),
  children: many(themes, { relationName: "themeHierarchy" }),
  workThemes: many(workThemes),
}));

export const workThemes = pgTable(
  "work_themes",
  {
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    themeId: uuid("theme_id")
      .notNull()
      .references(() => themes.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.workId, t.themeId] })],
);

export const workThemesRelations = relations(workThemes, ({ one }) => ({
  work: one(works, {
    fields: [workThemes.workId],
    references: [works.id],
  }),
  theme: one(themes, {
    fields: [workThemes.themeId],
    references: [themes.id],
  }),
}));
