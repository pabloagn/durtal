import {
  pgTable,
  uuid,
  text,
  integer,
  smallint,
  boolean,
  timestamp,
  check,
  index,
  real,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { works } from "./works";
import { authors } from "./authors";
import { collections } from "./collections";

export const media = pgTable(
  "media",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    // Polymorphic owner — exactly one must be set
    workId: uuid("work_id").references(() => works.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => authors.id, {
      onDelete: "cascade",
    }),
    collectionId: uuid("collection_id").references(() => collections.id, {
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

    // Active flag — for poster/background, only one active per owner+type
    isActive: boolean("is_active").notNull().default(true),

    // Crop / focal-point positioning (CSS object-position + scale)
    cropX: real("crop_x").notNull().default(50), // 0-100 horizontal %
    cropY: real("crop_y").notNull().default(50), // 0-100 vertical %
    cropZoom: real("crop_zoom").notNull().default(100), // 100 = no zoom

    // Display adjustments (CSS filter, percent; 100 = unchanged). Like crop,
    // applied at render time only: the S3 file is never modified.
    brightness: real("brightness").notNull().default(100),
    contrast: real("contrast").notNull().default(100),

    // Author monochrome processing — original (color) S3 key + tuning params
    originalS3Key: text("original_s3_key"),
    processingParams: jsonb("processing_params"),

    // Extracted color palette (poster images only)
    colorPalette: jsonb("color_palette"),

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
      sql`num_nonnulls(${t.workId}, ${t.authorId}, ${t.collectionId}) = 1`,
    ),
    index("media_work_id_type_active_idx").on(t.workId, t.type, t.isActive),
    index("media_author_id_active_idx").on(t.authorId, t.isActive),
    index("media_collection_id_type_active_idx").on(
      t.collectionId,
      t.type,
      t.isActive,
    ),
  ],
);

export const mediaRelations = relations(media, ({ one }) => ({
  work: one(works, { fields: [media.workId], references: [works.id] }),
  author: one(authors, { fields: [media.authorId], references: [authors.id] }),
  collection: one(collections, {
    fields: [media.collectionId],
    references: [collections.id],
  }),
}));
