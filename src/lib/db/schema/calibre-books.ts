import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { works } from "./works";

export const calibreBooks = pgTable(
  "calibre_books",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    calibreId: integer("calibre_id").notNull(),
    calibreUuid: text("calibre_uuid"),

    // Metadata from Calibre
    title: text("title").notNull(),
    authorSort: text("author_sort"),
    path: text("path").notNull(),
    hasCover: boolean("has_cover").notNull().default(false),
    coverS3Key: text("cover_s3_key"),
    isbn: text("isbn"),
    formats: jsonb("formats").$type<
      {
        format: string;
        fileName: string;
        sizeBytes: number;
        s3Key: string;
      }[]
    >(),
    pubdate: text("pubdate"),

    // Link to Durtal catalogue (nullable -- many Calibre books won't be in Durtal)
    workId: uuid("work_id").references(() => works.id, { onDelete: "set null" }),

    // Sync metadata
    lastSynced: timestamp("last_synced", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("calibre_books_calibre_id_idx").on(t.calibreId)],
);

export const calibreBooksRelations = relations(calibreBooks, ({ one }) => ({
  work: one(works, {
    fields: [calibreBooks.workId],
    references: [works.id],
  }),
}));
