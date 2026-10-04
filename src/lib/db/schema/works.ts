import { pgTable, uuid, text, smallint, boolean, timestamp, index, date, check } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import {
  catalogueStatusEnum,
  acquisitionPriorityEnum,
  workKindEnum,
} from "./enums";
import { editions } from "./editions";
import { workAuthors } from "./authors";
import { workSubjects } from "./taxonomy";
import { media } from "./media";
import { series } from "./series";
import { workTypes } from "./work-types";
import { workRecommenders } from "./recommenders";
import { workCategories } from "./book-categories";
import { workLiteraryMovements } from "./literary-movements";
import { workThemes } from "./themes";
import { workArtTypes } from "./art-types";
import { workArtMovements } from "./art-movements";
import { workKeywords } from "./keywords";
import { workAttributes } from "./attributes";
import { workStatusHistory } from "./work-status-history";
import { customTaxonomyItemWorks } from "./taxonomy-families";

export const works = pgTable("works", {
  id: uuid("id").defaultRandom().primaryKey(),

  // Stable medium identity, independent of descriptive work-type taxonomy.
  kind: workKindEnum("kind").notNull().default("book"),

  // Work-level metadata
  title: text("title").notNull(),
  slug: text("slug").unique(),
  originalLanguage: text("original_language").default("en"),
  originalYear: smallint("original_year"),
  description: text("description"),
  seriesName: text("series_name"), // deprecated: use seriesId instead
  seriesPosition: text("series_position"), // stored as text, parsed as decimal
  seriesId: uuid("series_id").references(() => series.id, {
    onDelete: "set null",
  }),
  isAnthology: boolean("is_anthology").notNull().default(false),
  workTypeId: uuid("work_type_id").references(() => workTypes.id, {
    onDelete: "set null",
  }),

  // Personal
  notes: text("notes"),
  rating: smallint("rating"),
  isFavourite: boolean("is_favourite").notNull().default(false),

  // Catalogue lifecycle
  catalogueStatus: catalogueStatusEnum("catalogue_status").notNull().default("tracked"),
  acquisitionPriority: acquisitionPriorityEnum("acquisition_priority").notNull().default("none"),

  // Personal availability assessment, independent of catalogue status.
  isRare: boolean("is_rare").notNull().default(false),
  huntAssessedOn: date("hunt_assessed_on", { mode: "string" }),

  // Personal warning: explicit, transgressive works not to recommend.
  // The UI calls this mark "Anathema" (src/lib/constants/marks.ts).
  isPoison: boolean("is_poison").notNull().default(false),

  // External catalogue pages (validated https links; shared by all editions)
  goodreadsUrl: text("goodreads_url"),
  storygraphUrl: text("storygraph_url"),

  // Metadata provenance
  metadataSource: text("metadata_source"),
  metadataSourceId: text("metadata_source_id"),

  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Expand first: new kinds cannot leak into legacy book queries. Widen only
  // when their complete domain adapters and compatibility tests are ready.
  // Matches getEnabledWorkKinds() (src/lib/catalogue/domains.ts).
  check("works_kind_enabled_check", sql`${t.kind} IN ('book', 'perfume')`),
  check("works_book_series_check", sql`${t.kind} = 'book' OR (${t.seriesId} IS NULL AND ${t.seriesName} IS NULL AND ${t.seriesPosition} IS NULL)`),
  check("works_nonbook_lifecycle_check", sql`${t.kind} = 'book' OR (${t.catalogueStatus} = 'tracked' AND ${t.acquisitionPriority} = 'none' AND NOT ${t.isRare} AND ${t.huntAssessedOn} IS NULL)`),
  check("works_language_domain_check", sql`(${t.kind}='book' and ${t.originalLanguage} is not null) or (${t.kind}<>'book' and ${t.originalLanguage} is null)`),
  index("works_catalogue_status_idx").on(t.catalogueStatus),
  index("works_series_id_idx").on(t.seriesId),
  index("works_created_at_idx").on(t.createdAt),
  index("works_rating_idx").on(t.rating),
  check("works_hunt_assessment_check", sql`(
    (NOT ${t.isRare} AND ${t.huntAssessedOn} IS NULL)
    OR (${t.isRare} AND ${t.huntAssessedOn} IS NOT NULL)
  )`),
]);

export const worksRelations = relations(works, ({ one, many }) => ({
  editions: many(editions),
  workAuthors: many(workAuthors),
  workSubjects: many(workSubjects),
  media: many(media),
  series: one(series, {
    fields: [works.seriesId],
    references: [series.id],
  }),
  workType: one(workTypes, {
    fields: [works.workTypeId],
    references: [workTypes.id],
  }),
  workRecommenders: many(workRecommenders),
  workCategories: many(workCategories),
  workLiteraryMovements: many(workLiteraryMovements),
  workThemes: many(workThemes),
  workArtTypes: many(workArtTypes),
  workArtMovements: many(workArtMovements),
  workKeywords: many(workKeywords),
  workAttributes: many(workAttributes),
  statusHistory: many(workStatusHistory),
  customTaxonomyItemWorks: many(customTaxonomyItemWorks),
}));
