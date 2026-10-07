import { isbn10To13, validIsbn10 } from "@/lib/match/plan";
import { LANGUAGES } from "@/lib/constants/languages";
import { normalizeLanguage } from "@/lib/utils/language";
import { stripHtmlToText } from "@/lib/utils/sanitize";
import type { AppSettings } from "@/lib/actions/settings";
import type { CreateWorkInput } from "@/lib/validations";
import type { WizardBookInput } from "@/lib/validations/wizard";
import type { InstanceDraft } from "@/components/books/instance-form";
import type { SearchResult } from "@/lib/api/types";

// ── Steps ────────────────────────────────────────────────────────────────────

export type Step =
  | "search"
  | "duplicate"
  | "details"
  | "edition"
  | "instance"
  | "categorize"
  | "confirm";

/** The steps the progress row names. "duplicate" is a passing step, shown as Search */
export const STEPS: { key: Step; label: string }[] = [
  { key: "search", label: "Search" },
  { key: "details", label: "Details" },
  { key: "edition", label: "Edition" },
  { key: "instance", label: "Instance" },
  { key: "categorize", label: "Categorize" },
  { key: "confirm", label: "Confirm" },
];

// ── Data from the server ─────────────────────────────────────────────────────

export interface DuplicateWork {
  id: string;
  title: string;
  workAuthors: { author: { name: string } }[];
  editions: { id: string; instances: { id: string }[] }[];
}

export interface RefDataItem {
  id: string;
  name: string;
}

export interface LocationItem {
  id: string;
  name: string;
  type: string;
  subLocations: { id: string; name: string }[];
}

/** The taxonomy families a new book can be filed under, in the form's order */
export const TAXONOMY_KEYS = [
  "subjects",
  "genres",
  "tags",
  "collections",
  "categories",
  "themes",
  "literaryMovements",
  "artTypes",
  "artMovements",
  "keywords",
  "attributes",
] as const;

export type TaxonomyKey = (typeof TAXONOMY_KEYS)[number];
/** Every family's choices */
export type TaxonomyLists = Record<TaxonomyKey, RefDataItem[]>;
/** The ids chosen in each family */
export type TaxonomySelection = Record<TaxonomyKey, string[]>;

/** One value for each family */
export function perFamily<T>(value: () => T): Record<TaxonomyKey, T> {
  const families = {} as Record<TaxonomyKey, T>;
  for (const key of TAXONOMY_KEYS) families[key] = value();
  return families;
}

export function emptyTaxonomy(): TaxonomySelection {
  return perFamily(() => []);
}

export const LANGUAGE_OPTIONS = LANGUAGES.map((l) => ({
  value: l.value,
  label: l.label,
}));

// ── Drafts ───────────────────────────────────────────────────────────────────

/** The Details step: the work */
export interface WorkDraft {
  title: string;
  authorName: string;
  originalYear: string;
  originalLanguage: string;
  description: string;
  seriesName: string;
  seriesPosition: string;
  catalogueStatus: string;
  acquisitionPriority: string;
  recommenderIds: string[];
}

/** The Edition step */
export interface EditionDraft {
  isbn13: string;
  publisher: string;
  publicationYear: string;
  language: string;
  pageCount: string;
  binding: string;
  coverUrl: string;
}

/** The search result the details came from, if any */
export interface MetadataSource {
  source: string;
  sourceId: string;
}

type Defaults = Pick<AppSettings, "newBookLanguage" | "newBookStatus">;

/** A new work starts in the language and status from Settings, General */
export function newWorkDraft(settings: Defaults): WorkDraft {
  return {
    title: "",
    authorName: "",
    originalYear: "",
    originalLanguage: settings.newBookLanguage,
    description: "",
    seriesName: "",
    seriesPosition: "",
    catalogueStatus: settings.newBookStatus,
    acquisitionPriority: "none",
    recommenderIds: [],
  };
}

/** An ISBN from the link also fills the field, for details entered by hand */
export function newEditionDraft(settings: Defaults, initialIsbn: string | null): EditionDraft {
  const ten = initialIsbn?.length === 10 ? validIsbn10(initialIsbn) : null;
  return {
    isbn13: initialIsbn ? (ten ? isbn10To13(ten) : initialIsbn) : "",
    publisher: "",
    publicationYear: "",
    language: settings.newBookLanguage,
    pageCount: "",
    binding: "",
    coverUrl: "",
  };
}

/**
 * What a search result fills in. The series, status, priority and
 * recommenders stay as they are.
 */
export function fromSearchResult(
  result: SearchResult,
  fallbackLanguage: string,
): { work: Partial<WorkDraft>; edition: EditionDraft; source: MetadataSource } {
  const language = normalizeLanguage(result.language) ?? fallbackLanguage;
  return {
    work: {
      title: result.title,
      authorName: result.authors[0] ?? "",
      originalYear: String(result.publicationYear ?? ""),
      originalLanguage: language,
      description: stripHtmlToText(result.description ?? ""),
    },
    edition: {
      isbn13: result.isbn13 ?? "",
      publisher: result.publisher ?? "",
      publicationYear: String(result.publicationYear ?? ""),
      language,
      pageCount: String(result.pageCount ?? ""),
      binding: result.binding ?? "",
      coverUrl: result.coverUrl ?? "",
    },
    source: { source: result.source, sourceId: result.sourceId },
  };
}

/** Wishlist statuses: the book is not owned yet, so copies are optional */
export function isWishlistStatus(status: string): boolean {
  return ["tracked", "shortlisted", "wanted"].includes(status);
}

// ── What is saved ────────────────────────────────────────────────────────────

// Fast Track and "Add to catalogue" send the same Details values and edition defaults.

export function workInput(work: WorkDraft, source: MetadataSource) {
  return {
    title: work.title.trim(),
    originalLanguage: work.originalLanguage,
    originalYear: work.originalYear ? parseInt(work.originalYear, 10) : undefined,
    description: work.description || undefined,
    seriesName: work.seriesName || undefined,
    seriesPosition: work.seriesPosition || undefined,
    catalogueStatus: work.catalogueStatus as CreateWorkInput["catalogueStatus"],
    acquisitionPriority:
      work.acquisitionPriority as CreateWorkInput["acquisitionPriority"],
    recommenderIds:
      work.recommenderIds.length > 0 ? work.recommenderIds : undefined,
    metadataSource: source.source || undefined,
    metadataSourceId: source.sourceId || undefined,
  };
}

export function editionInput(title: string, edition: EditionDraft, source: MetadataSource) {
  const cleanIsbn = edition.isbn13.replace(/-/g, "");
  return {
    title: title.trim(),
    isbn13: cleanIsbn.length === 13 ? cleanIsbn : undefined,
    publisher: edition.publisher || undefined,
    publicationYear: edition.publicationYear
      ? parseInt(edition.publicationYear, 10)
      : undefined,
    language: edition.language,
    pageCount: edition.pageCount ? parseInt(edition.pageCount, 10) : undefined,
    binding: edition.binding || undefined,
    coverSourceUrl: edition.coverUrl || undefined,
    metadataSource: source.source || undefined,
  };
}

type CopyInput = NonNullable<WizardBookInput["copies"]>[number];

export function copyInput(draft: InstanceDraft): CopyInput {
  return {
    locationId: draft.locationId,
    subLocationId: draft.subLocationId || undefined,
    format: draft.format || undefined,
    condition: draft.condition || undefined,
    hasDustJacket: draft.hasDustJacket,
    hasSlipcase: draft.hasSlipcase,
    conditionNotes: draft.conditionNotes || undefined,
    isSigned: draft.isSigned,
    signedBy: draft.signedBy || undefined,
    inscription: draft.inscription || undefined,
    isFirstPrinting: draft.isFirstPrinting,
    provenance: draft.provenance || undefined,
    acquisitionType: draft.acquisitionType || undefined,
    acquisitionDate: draft.acquisitionDate || undefined,
    acquisitionSource: draft.acquisitionSource || undefined,
    acquisitionPrice: draft.acquisitionPrice || undefined,
    acquisitionCurrency: draft.acquisitionCurrency || undefined,
    fileSizeBytes: draft.fileSizeBytes
      ? parseInt(draft.fileSizeBytes, 10)
      : undefined,
    notes: draft.notes || undefined,
  };
}

/** The whole book for one write: a new work with its taxonomy, or an edition of an existing one */
export function wizardBookInput({
  work,
  edition,
  source,
  existingWorkId,
  taxonomy,
  copies,
}: {
  work: WorkDraft;
  edition: EditionDraft;
  source: MetadataSource;
  existingWorkId: string | null;
  taxonomy: TaxonomySelection;
  copies: InstanceDraft[];
}): WizardBookInput {
  return {
    authorName: work.authorName.trim(),
    existingWorkId: existingWorkId || null,
    work: existingWorkId ? undefined : workInput(work, source),
    taxonomy: existingWorkId
      ? undefined
      : {
          subjectIds: taxonomy.subjects,
          categoryIds: taxonomy.categories,
          themeIds: taxonomy.themes,
          literaryMovementIds: taxonomy.literaryMovements,
          artTypeIds: taxonomy.artTypes,
          artMovementIds: taxonomy.artMovements,
          keywordIds: taxonomy.keywords,
          attributeIds: taxonomy.attributes,
        },
    edition: {
      ...editionInput(work.title, edition, source),
      genreIds: taxonomy.genres.length > 0 ? taxonomy.genres : undefined,
      tagIds: taxonomy.tags.length > 0 ? taxonomy.tags : undefined,
    },
    copies: copies.map(copyInput),
    collectionIds: taxonomy.collections,
  };
}

/**
 * Whether the page before this one is a page of this app: the wizard was
 * reached by an in-app link (the document was loaded at another address), or
 * the document was loaded from one of our pages.
 */
export function cameFromApp(): boolean {
  const [loaded] = performance.getEntriesByType(
    "navigation",
  ) as PerformanceNavigationTiming[];
  if (loaded && new URL(loaded.name).pathname !== location.pathname) return true;
  try {
    return (
      !!document.referrer &&
      new URL(document.referrer).origin === location.origin
    );
  } catch {
    return false;
  }
}
