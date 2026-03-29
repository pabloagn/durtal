import { pgTable, uuid, text, smallint, boolean, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { catalogueStatusEnum, acquisitionPriorityEnum } from "./enums";
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

export const works = pgTable("works", {
  id: uuid("id").defaultRandom().primaryKey(),

  // Work-level metadata
  title: text("title").notNull(),
  slug: text("slug").unique(),
  originalLanguage: text("original_language").notNull().default("en"),
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

  // Catalogue lifecycle
  catalogueStatus: catalogueStatusEnum("catalogue_status").notNull().default("tracked"),
  acquisitionPriority: acquisitionPriorityEnum("acquisition_priority").notNull().default("none"),

  // Metadata provenance
  metadataSource: text("metadata_source"),
  metadataSourceId: text("metadata_source_id"),

  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
}));
