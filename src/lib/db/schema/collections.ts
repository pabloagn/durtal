import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { editions } from "./editions";
import { media } from "./media";
import { works } from "./works";

export const collections = pgTable("collections", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  // Lucide icon name (PascalCase key of lucide-react `icons`), shown beside the name.
  icon: text("icon"),
  // Poster and background images live in `media` (collection_id), like works and authors.
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const collectionsRelations = relations(collections, ({ many }) => ({
  collectionEditions: many(collectionEditions),
  collectionWorks: many(collectionWorks),
  media: many(media),
}));

export const collectionEditions = pgTable(
  "collection_editions",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id")
      .notNull()
      .references(() => editions.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.editionId] })],
);

export const collectionEditionsRelations = relations(
  collectionEditions,
  ({ one }) => ({
    collection: one(collections, {
      fields: [collectionEditions.collectionId],
      references: [collections.id],
    }),
    edition: one(editions, {
      fields: [collectionEditions.editionId],
      references: [editions.id],
    }),
  }),
);

/**
 * A whole work in a collection (SLN-362): a film, perfume or painting, or a
 * book collected without choosing an edition. It shares one order with the
 * collection's editions (sort_order across both tables). A book can be in a
 * collection as a work and as editions: the page shows its editions and
 * counts the book once.
 */
export const collectionWorks = pgTable(
  "collection_works",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.workId] }),
    index("collection_work_work_idx").on(t.workId),
  ],
);

export const collectionWorksRelations = relations(collectionWorks, ({ one }) => ({
  collection: one(collections, {
    fields: [collectionWorks.collectionId],
    references: [collections.id],
  }),
  work: one(works, {
    fields: [collectionWorks.workId],
    references: [works.id],
  }),
}));
