/**
 * The library's filter vocabulary (SLN-405): URL keys and option labels, for
 * the panel in the browser and the parser on the server
 * (`./filter-params.ts`). No zod here, so the panel does not ship it.
 */
/** The book taxonomies a book can be filtered by: URL key and name */
export const BOOK_TAXONOMY_FILTERS = [
  { key: "subject", label: "Subjects" },
  { key: "category", label: "Categories" },
  { key: "theme", label: "Themes" },
  { key: "movement", label: "Literary movements" },
  { key: "artType", label: "Art types" },
  { key: "artMovement", label: "Art movements" },
  { key: "keyword", label: "Keywords" },
  { key: "attribute", label: "Attributes" },
] as const;
export type BookTaxonomyKey = (typeof BOOK_TAXONOMY_FILTERS)[number]["key"];
export const TAXONOMY_KEYS = BOOK_TAXONOMY_FILTERS.map((t) => t.key) as [BookTaxonomyKey, ...BookTaxonomyKey[]];

/** A copy's collector details */
export const COPY_FLAGS = [
  { value: "signed", label: "Signed" },
  { value: "first", label: "First printing" },
] as const;
export type CopyFlag = (typeof COPY_FLAGS)[number]["value"];

export const SERIES_FILTERS = [
  { value: "in", label: "In a series" },
  { value: "none", label: "Standalone" },
] as const;
export type SeriesFilter = (typeof SERIES_FILTERS)[number]["value"];

export const POSTER_FILTERS = [
  { value: "has", label: "Has a picture" },
  { value: "missing", label: "No picture" },
] as const;

export const ACQUISITION_PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export type AcquisitionPriorityFilter = (typeof ACQUISITION_PRIORITIES)[number];

/** Every URL key a book filter reads: "Clear all" removes these */
export const BOOK_FILTER_KEYS = [
  "mark",
  "rare",
  "publisher",
  "priority",
  "rating",
  "location",
  "format",
  "copy",
  "lang",
  "origLang",
  "yearFrom",
  "yearTo",
  "series",
  ...TAXONOMY_KEYS,
  "color",
  "poster",
] as const;

