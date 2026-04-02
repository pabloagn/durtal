// ── Enums ───────────────────────────────────────────────────────────────────
export {
  genderEnum,
  catalogueStatusEnum,
  acquisitionPriorityEnum,
  instanceStatusEnum,
  dispositionTypeEnum,
  venueTypeEnum,
  orderStatusEnum,
  acquisitionMethodEnum,
} from "./enums";

// ── Core tables ─────────────────────────────────────────────────────────────
export { works, worksRelations } from "./works";
export {
  editions,
  editionsRelations,
} from "./editions";
export { instances, instancesRelations } from "./instances";

// ── Status history (audit trail) ────────────────────────────────────────────
export { workStatusHistory, workStatusHistoryRelations } from "./work-status-history";
export { instanceStatusHistory, instanceStatusHistoryRelations } from "./instance-status-history";
export {
  authors,
  authorsRelations,
  workAuthors,
  workAuthorsRelations,
  editionContributors,
  editionContributorsRelations,
  authorContributionTypes,
  authorContributionTypesRelations,
} from "./authors";
export {
  locations,
  locationsRelations,
  subLocations,
  subLocationsRelations,
} from "./locations";
export {
  subjects,
  workSubjects,
  workSubjectsRelations,
  genres,
  genresRelations,
  editionGenres,
  editionGenresRelations,
  tags,
  editionTags,
  editionTagsRelations,
} from "./taxonomy";
export {
  collections,
  collectionsRelations,
  collectionEditions,
  collectionEditionsRelations,
} from "./collections";
export { imports } from "./imports";
export { media, mediaRelations } from "./media";

// ── Reference tables ────────────────────────────────────────────────────────
export { languages } from "./languages";
export { countries } from "./countries";
export { places, placesRelations } from "./places";
export { workTypes } from "./work-types";
export {
  contributionTypes,
  contributionTypesRelations,
} from "./contribution-types";
export { centuries } from "./centuries";
export { sources } from "./sources";
export { series, seriesRelations } from "./series";
export {
  recommenders,
  recommendersRelations,
  workRecommenders,
  workRecommendersRelations,
} from "./recommenders";
export {
  publishingHouses,
  publishingHousesRelations,
  publisherSpecialties,
  publisherSpecialtiesRelations,
  publishingHouseSpecialties,
  publishingHouseSpecialtiesRelations,
} from "./publishing-houses";

// ── Taxonomy extensions ─────────────────────────────────────────────────────
export {
  bookCategories,
  bookCategoriesRelations,
  workCategories,
  workCategoriesRelations,
} from "./book-categories";
export {
  literaryMovements,
  literaryMovementsRelations,
  workLiteraryMovements,
  workLiteraryMovementsRelations,
} from "./literary-movements";
export {
  themes,
  themesRelations,
  workThemes,
  workThemesRelations,
} from "./themes";
export {
  artTypes,
  artTypesRelations,
  workArtTypes,
  workArtTypesRelations,
} from "./art-types";
export {
  artMovements,
  artMovementsRelations,
  workArtMovements,
  workArtMovementsRelations,
} from "./art-movements";
export {
  keywords,
  keywordsRelations,
  workKeywords,
  workKeywordsRelations,
} from "./keywords";
export {
  attributes,
  attributesRelations,
  workAttributes,
  workAttributesRelations,
} from "./attributes";
export { galleryLayouts } from "./gallery-layouts";

// ── Venues ───────────────────────────────────────────────────────────────────
export { venues, venuesRelations } from "./venues";

// ── Orders ───────────────────────────────────────────────────────────────────
export { orders, ordersRelations } from "./orders";
export {
  orderStatusHistory,
  orderStatusHistoryRelations,
} from "./order-status-history";

// ── Calibre / Reader ─────────────────────────────────────────────────────────
export { calibreBooks, calibreBooksRelations } from "./calibre-books";
export { readingProgress, readingProgressRelations } from "./reading-progress";

// ── Activity events ─────────────────────────────────────────────────────────
export { activityEvents } from "./activity-events";

// ── Comments ────────────────────────────────────────────────────────────────
export {
  comments,
  commentsRelations,
  commentAttachments,
  commentAttachmentsRelations,
} from "./comments";
