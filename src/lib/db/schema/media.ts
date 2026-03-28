import {
  pgTable,
  uuid,
  text,
  integer,
  smallint,
  timestamp,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { works } from "./works";
import { authors } from "./authors";

export const media = pgTable(
  "media",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    // Polymorphic owner — exactly one must be set
    workId: uuid("work_id").references(() => works.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => authors.id, {
      onDelete: "cascade",
    }),

    // Classification
    type: text("type").notNull(), // 'poster' | 'background' | 'gallery'
    s3Key: text("s3_key").notNull(),
    thumbnailS3Key: text("thumbnail_s3_key"),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type"),

    // Dimensions
    width: integer("width"),
    height: integer("height"),
    sizeBytes: integer("size_bytes"),

    // Ordering and metadata
    sortOrder: smallint("sort_order").notNull().default(0),
    caption: text("caption"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "media_owner_check",
      sql`(work_id IS NOT NULL) != (author_id IS NOT NULL)`,
    ),
  ],
);

export const mediaRelations = relations(media, ({ one }) => ({
  work: one(works, { fields: [media.workId], references: [works.id] }),
  author: one(authors, { fields: [media.authorId], references: [authors.id] }),
}));
