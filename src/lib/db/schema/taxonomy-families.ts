import { pgTable, uuid, text, boolean, integer, timestamp, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { works } from "./works";
import { editions } from "./editions";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

// ── Taxonomy Families (registry of all label groups) ─────────────────────────

export const taxonomyFamilies = pgTable("taxonomy_families", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  icon: text("icon"),
  color: text("color"),
  isSystem: boolean("is_system").notNull().default(false),
  systemTable: text("system_table"),
  entityLevel: text("entity_level").notNull().default("work"),
  hierarchical: boolean("hierarchical").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const taxonomyFamiliesRelations = relations(taxonomyFamilies, ({ many }) => ({
  items: many(customTaxonomyItems),
}));

// ── Custom Taxonomy Items (items in user-created families) ───────────────────

export const customTaxonomyItems = pgTable("custom_taxonomy_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  familyId: uuid("family_id").notNull().references(() => taxonomyFamilies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  color: text("color"),
  parentId: uuid("parent_id").references((): AnyPgColumn => customTaxonomyItems.id, { onDelete: "set null" }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("custom_taxonomy_items_family_slug_idx").on(t.familyId, t.slug),
]);

export const customTaxonomyItemsRelations = relations(customTaxonomyItems, ({ one, many }) => ({
  family: one(taxonomyFamilies, {
    fields: [customTaxonomyItems.familyId],
    references: [taxonomyFamilies.id],
  }),
  parent: one(customTaxonomyItems, {
    fields: [customTaxonomyItems.parentId],
    references: [customTaxonomyItems.id],
    relationName: "customTaxonomyHierarchy",
  }),
  children: many(customTaxonomyItems, { relationName: "customTaxonomyHierarchy" }),
  workLinks: many(customTaxonomyItemWorks),
  editionLinks: many(customTaxonomyItemEditions),
}));

// ── Junction: Custom Items ↔ Works ───────────────────────────────────────────

export const customTaxonomyItemWorks = pgTable("custom_taxonomy_item_works", {
  itemId: uuid("item_id").notNull().references(() => customTaxonomyItems.id, { onDelete: "cascade" }),
  workId: uuid("work_id").notNull().references(() => works.id, { onDelete: "cascade" }),
}, (t) => [
  primaryKey({ columns: [t.itemId, t.workId] }),
]);

export const customTaxonomyItemWorksRelations = relations(customTaxonomyItemWorks, ({ one }) => ({
  item: one(customTaxonomyItems, {
    fields: [customTaxonomyItemWorks.itemId],
    references: [customTaxonomyItems.id],
  }),
  work: one(works, {
    fields: [customTaxonomyItemWorks.workId],
    references: [works.id],
  }),
}));

// ── Junction: Custom Items ↔ Editions ────────────────────────────────────────

export const customTaxonomyItemEditions = pgTable("custom_taxonomy_item_editions", {
  itemId: uuid("item_id").notNull().references(() => customTaxonomyItems.id, { onDelete: "cascade" }),
  editionId: uuid("edition_id").notNull().references(() => editions.id, { onDelete: "cascade" }),
}, (t) => [
  primaryKey({ columns: [t.itemId, t.editionId] }),
]);

export const customTaxonomyItemEditionsRelations = relations(customTaxonomyItemEditions, ({ one }) => ({
  item: one(customTaxonomyItems, {
    fields: [customTaxonomyItemEditions.itemId],
    references: [customTaxonomyItems.id],
  }),
  edition: one(editions, {
    fields: [customTaxonomyItemEditions.editionId],
    references: [editions.id],
  }),
}));
