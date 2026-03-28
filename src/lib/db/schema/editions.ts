import {
  pgTable,
  uuid,
  text,
  smallint,
  integer,
  boolean,
  date,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { works } from "./works";
import { instances } from "./instances";
import { editionContributors } from "./authors";
import { editionGenres, editionTags } from "./taxonomy";
import { collectionEditions } from "./collections";

export const editions = pgTable("editions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workId: uuid("work_id")
    .notNull()
    .references(() => works.id, { onDelete: "cascade" }),

  // Identifiers
  isbn13: text("isbn_13").unique(),
  isbn10: text("isbn_10").unique(),
  asin: text("asin"),
  lccn: text("lccn"),
  oclc: text("oclc"),
  openLibraryKey: text("open_library_key"),
  googleBooksId: text("google_books_id"),
  goodreadsId: text("goodreads_id"),

  // Title
  title: text("title").notNull(),
  subtitle: text("subtitle"),

  // Publication
  publisher: text("publisher"),
  imprint: text("imprint"),
  publicationDate: date("publication_date"),
  publicationYear: smallint("publication_year"),
  publicationCountry: text("publication_country"),

  // Edition details
  editionName: text("edition_name"),
  editionNumber: smallint("edition_number"),
  printingNumber: smallint("printing_number"),
  isFirstEdition: boolean("is_first_edition").notNull().default(false),
  isLimitedEdition: boolean("is_limited_edition").notNull().default(false),
  limitedEditionCount: integer("limited_edition_count"),

  // Language
  language: text("language").notNull().default("en"),
  isTranslated: boolean("is_translated").notNull().default(false),

  // Physical description
  pageCount: integer("page_count"),
  binding: text("binding"),
  heightMm: smallint("height_mm"),
  widthMm: smallint("width_mm"),
  depthMm: smallint("depth_mm"),
  weightGrams: integer("weight_grams"),
  illustrationType: text("illustration_type"),

  // Content
  description: text("description"),
  tableOfContents: text("table_of_contents"),

  // Cover
  coverS3Key: text("cover_s3_key"),
  thumbnailS3Key: text("thumbnail_s3_key"),
  coverSourceUrl: text("cover_source_url"),

  // Metadata provenance
  metadataSource: text("metadata_source"),
  metadataLastFetched: timestamp("metadata_last_fetched", { withTimezone: true }),
  metadataLocked: boolean("metadata_locked").notNull().default(false),

  // Personal
  notes: text("notes"),

  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const editionsRelations = relations(editions, ({ one, many }) => ({
  work: one(works, {
    fields: [editions.workId],
    references: [works.id],
  }),
  instances: many(instances),
  contributors: many(editionContributors),
  editionGenres: many(editionGenres),
  editionTags: many(editionTags),
  collectionEditions: many(collectionEditions),
}));
