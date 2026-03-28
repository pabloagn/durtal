import type { InferSelectModel, InferInsertModel } from "drizzle-orm";
import type {
  works,
  editions,
  instances,
  authors,
  workAuthors,
  editionContributors,
  locations,
  subLocations,
  subjects,
  genres,
  tags,
  collections,
  imports,
  media,
} from "@/lib/db/schema";

// ── Select types (rows from DB) ─────────────────────────────────────────────

export type Work = InferSelectModel<typeof works>;
export type Edition = InferSelectModel<typeof editions>;
export type Instance = InferSelectModel<typeof instances>;
export type Author = InferSelectModel<typeof authors>;
export type WorkAuthor = InferSelectModel<typeof workAuthors>;
export type EditionContributor = InferSelectModel<typeof editionContributors>;
export type Location = InferSelectModel<typeof locations>;
export type SubLocation = InferSelectModel<typeof subLocations>;
export type Subject = InferSelectModel<typeof subjects>;
export type Genre = InferSelectModel<typeof genres>;
export type Tag = InferSelectModel<typeof tags>;
export type Collection = InferSelectModel<typeof collections>;
export type Import = InferSelectModel<typeof imports>;
export type Media = InferSelectModel<typeof media>;

// ── Insert types (for creating new rows) ────────────────────────────────────

export type NewWork = InferInsertModel<typeof works>;
export type NewEdition = InferInsertModel<typeof editions>;
export type NewInstance = InferInsertModel<typeof instances>;
export type NewAuthor = InferInsertModel<typeof authors>;
export type NewLocation = InferInsertModel<typeof locations>;
export type NewSubLocation = InferInsertModel<typeof subLocations>;
export type NewSubject = InferInsertModel<typeof subjects>;
export type NewGenre = InferInsertModel<typeof genres>;
export type NewTag = InferInsertModel<typeof tags>;
export type NewCollection = InferInsertModel<typeof collections>;
export type NewMedia = InferInsertModel<typeof media>;

// ── Composite types (with relations loaded) ─────────────────────────────────

export type WorkWithRelations = Work & {
  editions: EditionWithRelations[];
  workAuthors: (WorkAuthor & { author: Author })[];
  workSubjects: { subject: Subject }[];
  media: Media[];
};

export type EditionWithRelations = Edition & {
  work: Work;
  instances: (Instance & { location: Location; subLocation: SubLocation | null })[];
  contributors: (EditionContributor & { author: Author })[];
  editionGenres: { genre: Genre }[];
  editionTags: { tag: Tag }[];
};

export type AuthorWithRelations = Author & {
  workAuthors: (WorkAuthor & { work: Work })[];
  editionContributors: (EditionContributor & { edition: Edition })[];
  media: Media[];
};

export type LocationWithSubLocations = Location & {
  subLocations: SubLocation[];
};

export type CollectionWithEditions = Collection & {
  collectionEditions: { edition: EditionWithRelations; sortOrder: number }[];
};

// ── Enums (used across the app) ─────────────────────────────────────────────

export const WORK_AUTHOR_ROLES = ["author", "co_author"] as const;
export type WorkAuthorRole = (typeof WORK_AUTHOR_ROLES)[number];

export const EDITION_CONTRIBUTOR_ROLES = [
  "translator",
  "editor",
  "illustrator",
  "foreword",
  "afterword",
  "introduction",
  "narrator",
  "photographer",
  "compiler",
] as const;
export type EditionContributorRole = (typeof EDITION_CONTRIBUTOR_ROLES)[number];

export const INSTANCE_FORMATS = [
  "hardcover",
  "paperback",
  "ebook",
  "audiobook",
  "pdf",
  "epub",
  "other",
] as const;
export type InstanceFormat = (typeof INSTANCE_FORMATS)[number];

export const INSTANCE_CONDITIONS = [
  "mint",
  "fine",
  "very_good",
  "good",
  "fair",
  "poor",
] as const;
export type InstanceCondition = (typeof INSTANCE_CONDITIONS)[number];

export const ACQUISITION_TYPES = [
  "purchased",
  "gift",
  "inherited",
  "borrowed",
  "found",
  "review_copy",
  "other",
] as const;
export type AcquisitionType = (typeof ACQUISITION_TYPES)[number];

export const CATALOGUE_STATUSES = [
  "tracked",
  "shortlisted",
  "wanted",
  "on_order",
  "accessioned",
  "deaccessioned",
] as const;
export type CatalogueStatus = (typeof CATALOGUE_STATUSES)[number];

export const ACQUISITION_PRIORITIES = [
  "none",
  "low",
  "medium",
  "high",
  "urgent",
] as const;
export type AcquisitionPriority = (typeof ACQUISITION_PRIORITIES)[number];

export const INSTANCE_STATUSES = [
  "available",
  "lent_out",
  "in_transit",
  "in_storage",
  "missing",
  "damaged",
  "deaccessioned",
] as const;
export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

export const DISPOSITION_TYPES = [
  "sold",
  "donated",
  "gifted",
  "traded",
  "lost",
  "stolen",
  "destroyed",
  "returned",
  "expired",
] as const;
export type DispositionType = (typeof DISPOSITION_TYPES)[number];

export const BINDING_TYPES = [
  "hardcover",
  "paperback",
  "leather",
  "cloth",
  "boards",
  "wrappers",
  "spiral",
  "saddle_stitch",
  "other",
] as const;
export type BindingType = (typeof BINDING_TYPES)[number];

export const LOCATION_TYPES = ["physical", "digital"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const MEDIA_TYPES = ["poster", "background", "gallery"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
