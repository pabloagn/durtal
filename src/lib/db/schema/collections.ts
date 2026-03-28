import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { editions } from "./editions";

export const collections = pgTable("collections", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  coverS3Key: text("cover_s3_key"),
  posterS3Key: text("poster_s3_key"),
  posterThumbnailS3Key: text("poster_thumbnail_s3_key"),
  backgroundS3Key: text("background_s3_key"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const collectionsRelations = relations(collections, ({ many }) => ({
  collectionEditions: many(collectionEditions),
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
