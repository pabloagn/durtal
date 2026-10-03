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
import { publishingHouses } from "./publishing-houses";
import { artObjects } from "./paintings";
import { perfumeVariants } from "./perfumes";
import { sourceRecords } from "./provenance";
import type { AppliedCrop } from "@/lib/media/crop";

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
    organizationId: uuid("organization_id").references(
      () => publishingHouses.id,
      { onDelete: "cascade" },
    ),
    artObjectId: uuid("art_object_id").references(() => artObjects.id, {
      onDelete: "cascade",
    }),
    perfumeVariantId: uuid("perfume_variant_id").references(
      () => perfumeVariants.id,
      { onDelete: "cascade" },
    ),

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

    // Legacy CSS framing (object-position + scale) applied at render time.
    // A saved crop moves into `appliedCrop` and resets these to the default.
    cropX: real("crop_x").notNull().default(50), // 0-100 horizontal %
    cropY: real("crop_y").notNull().default(50), // 0-100 vertical %
    cropZoom: real("crop_zoom").notNull().default(100), // 100 = no zoom

    // Real crop: s3Key and thumbnailS3Key hold the cropped image. The
    // full-size image before the crop stays at uncroppedS3Key, never modified.
    // Both are set, or neither.
    uncroppedS3Key: text("uncropped_s3_key"),
    appliedCrop: jsonb("applied_crop").$type<AppliedCrop>(),

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

    // Description and attribution. Alt text describes the image for people
    // who cannot see it; credit, license and source say whose image it is.
    altText: text("alt_text"),
    credit: text("credit"),
    license: text("license"),
    licenseUrl: text("license_url"),
    sourceUrl: text("source_url"),
    sourceRecordId: uuid("source_record_id").references(() => sourceRecords.id),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "media_owner_check",
      sql`num_nonnulls(${t.workId}, ${t.authorId}, ${t.collectionId}, ${t.organizationId}, ${t.artObjectId}, ${t.perfumeVariantId}) = 1`,
    ),
    check(
      "media_type_check",
      sql`${t.type} in ('poster','background','gallery')
  and not (${t.collectionId} is not null and ${t.type}='gallery')
  and not ((${t.organizationId} is not null or ${t.artObjectId} is not null or ${t.perfumeVariantId} is not null) and ${t.type}='background')`,
    ),
    check(
      "media_attribution_check",
      sql`(${t.altText} is null or length(trim(${t.altText})) between 1 and 1000)
        and (${t.credit} is null or length(trim(${t.credit})) between 1 and 500)
        and (${t.license} is null or length(trim(${t.license})) between 1 and 200)
        and (${t.licenseUrl} is null or (length(${t.licenseUrl}) <= 4000 and ${t.licenseUrl} ~ '^https?://[^[:space:]@/]+([/:?#][^[:space:]]*)?$'))
        and (${t.sourceUrl} is null or (length(${t.sourceUrl}) <= 4000 and ${t.sourceUrl} ~ '^https?://[^[:space:]@/]+([/:?#][^[:space:]]*)?$'))`,
    ),
    check(
      "media_applied_crop_check",
      sql`num_nonnulls(${t.uncroppedS3Key}, ${t.appliedCrop}) in (0, 2)`,
    ),
    index("media_work_id_type_active_idx").on(t.workId, t.type, t.isActive),
    index("media_author_id_active_idx").on(t.authorId, t.isActive),
    index("media_collection_id_type_active_idx").on(
      t.collectionId,
      t.type,
      t.isActive,
    ),
    index("media_organization_id_type_active_idx").on(
      t.organizationId,
      t.type,
      t.isActive,
    ),
    index("media_art_object_id_type_active_idx").on(
      t.artObjectId,
      t.type,
      t.isActive,
    ),
    index("media_perfume_variant_id_type_active_idx").on(
      t.perfumeVariantId,
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
  organization: one(publishingHouses, {
    fields: [media.organizationId],
    references: [publishingHouses.id],
  }),
  artObject: one(artObjects, {
    fields: [media.artObjectId],
    references: [artObjects.id],
  }),
  perfumeVariant: one(perfumeVariants, {
    fields: [media.perfumeVariantId],
    references: [perfumeVariants.id],
  }),
}));
