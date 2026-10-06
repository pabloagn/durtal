// ── Enums ───────────────────────────────────────────────────────────────────
export {
  genderEnum,
  attributionEnum,
  workKindEnum,
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
export { personDomains, personDomainsRelations, personAliases, personAliasesRelations, creditRoles, workCredits, workCreditsRelations } from "./people";
export { editions, editionsRelations } from "./editions";
export { instances, instancesRelations } from "./instances";

// ── Status history (audit trail) ────────────────────────────────────────────
export {
  workStatusHistory,
  workStatusHistoryRelations,
} from "./work-status-history";
export {
  instanceStatusHistory,
  instanceStatusHistoryRelations,
} from "./instance-status-history";
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
export { appSettings } from "./app-settings";
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
  collectionWorks,
  collectionWorksRelations,
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
  publisherAliasesRelations,
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
export {
  taxonomyFamilies,
  taxonomyFamiliesRelations,
  customTaxonomyItems,
  customTaxonomyItemsRelations,
  customTaxonomyItemWorks,
  customTaxonomyItemWorksRelations,
  customTaxonomyItemEditions,
  customTaxonomyItemEditionsRelations,
} from "./taxonomy-families";

// ── Venues ───────────────────────────────────────────────────────────────────
export { venues, venuesRelations } from "./venues";

// ── Orders ───────────────────────────────────────────────────────────────────
export { orders, ordersRelations } from "./orders";
export {
  orderStatusHistory,
  orderStatusHistoryRelations,
} from "./order-status-history";

// ── eBooks ───────────────────────────────────────────────────────────────────
export { ebooks, ebooksRelations, ebookFiles, ebookFilesRelations } from "./ebooks";
export { ebookPositions, ebookPositionsRelations } from "./ebook-positions";
export { ebookAnnotations, ebookAnnotationsRelations } from "./ebook-annotations";

// ── Book enrichment (SLN-462) ───────────────────────────────────────────────
export {
  enrichmentVocabularyVersions,
  enrichmentDimensions,
  enrichmentDimensionsRelations,
  enrichmentTerms,
  enrichmentTermsRelations,
  enrichmentClaims,
  enrichmentClaimsRelations,
  claimEvidence,
  claimEvidenceRelations,
  workEnrichmentValues,
  enrichmentApplications,
  enrichmentAutoAcceptRules,
  workPopularitySnapshots,
  enrichmentJobs,
} from "./enrichment";

// ── Activity events ─────────────────────────────────────────────────────────
export { activityEvents } from "./activity-events";

// ── Comments ────────────────────────────────────────────────────────────────
export {
  comments,
  commentsRelations,
  commentAttachments,
  commentAttachmentsRelations,
} from "./comments";

export { publisherAliases } from "./publishing-houses";
export {
  editionPublishers,
  editionPublishersRelations,
  acquisitionTargets,
  acquisitionTargetCopies,
  publisherIsbnPrefixes,
  ignoredPublisherNames,
  publisherAutoDecisions,
  publisherHierarchyChanges,
  editionEnrichments,
} from "./publisher-links";

export { imageAdjustments } from "./image-adjustments";
export { catalogueIdentifiers, sourceRecords, sourceRecordsRelations, catalogueDates } from "./provenance";
export * from "./perfumes";
export { taxonomyApplicability, taxonomyApplicabilityRelations } from "./taxonomy-applicability";
export { organizationRoles, organizationRolesRelations, organizationVenues, organizationVenuesRelations } from "./organizations";
export { harmonizationDecisions, harmonizationOperations, harmonizationRedirects } from "./harmonization";
export * from "./retailers";
export * from "./films";
export * from "./paintings";
export { workRelations } from "./work-relations";
export * from "./readings";
export * from "./reading-import-rows";
