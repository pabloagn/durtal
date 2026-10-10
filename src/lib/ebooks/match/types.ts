/** Read-only snapshot contracts. Loaders will supply these through the protected planning connection. */
export type MatchTier =
  | "exact"
  | "strong"
  | "likely"
  | "to_choose"
  | "same_author"
  | "conflict"
  | "duplicate"
  | "not_a_book"
  | "not_in_durtal";
export type EditionRule =
  | "isbn_edition"
  | "fill_copy"
  | "new_isbn_edition"
  | "placeholder_copy"
  | "new_edition";
export type MatchFlag =
  | "omnibus"
  | "sample"
  | "periodical"
  | "article"
  | "shared_isbn";
export type AuthorLevel = "identity" | "compatible" | "disagree" | "missing";
export interface Reason {
  code: string;
  text: string;
}
export interface MatchFile {
  id: string;
  sha256: string;
  format: string;
  sizeBytes: number;
  status: string;
  drm: string | null;
  /** Loader-proven delivery capability, including medallion validation, never inferred from format alone. */
  availability: "native" | "download" | "blocked";
  textLanguage?: string | null;
  /** Loader-validated derived cover belonging to this file's publication. */
  coverKey?: string | null;
}
export interface MatchEbook {
  id: string;
  title: string;
  subtitle?: string | null;
  authors: readonly string[];
  language: string | null;
  isbns: readonly string[];
  identifiers: Readonly<Record<string, readonly string[]>>;
  series?: string | null;
  seriesIndex?: number | null;
  publisher?: string | null;
  publishedYear?: number | null;
  coverKey?: string | null;
  preferredFileId?: string | null;
  files: readonly MatchFile[];
  createdAt: string;
  updatedAt: string;
  instanceId: string | null;
  matchState: "pending" | "linked" | "standalone" | "excluded";
  matchFingerprint: string | null;
  exclusionReason?: "duplicate" | "not_a_book" | "other" | null;
}
export interface MatchAuthor {
  id: string;
  name: string;
  sortName?: string | null;
  realName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  aliases: readonly string[];
}
export interface MatchEdition {
  id: string;
  workId: string;
  title: string;
  subtitle?: string | null;
  language: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  identifiers: Readonly<Record<string, readonly string[]>>;
  metadataSource: string | null;
  metadataLocked: boolean;
  updatedAt: string;
}
export interface MatchCopy {
  id: string;
  editionId: string;
  locationId: string;
  status: string;
  linkedEbookId: string | null;
  updatedAt: string;
}
export interface MatchWork {
  id: string;
  kind: "book";
  title: string;
  originalTitle?: string | null;
  originalLanguage: string | null;
  originalYear: number | null;
  catalogueStatus: string;
  authors: readonly MatchAuthor[];
  identifiers: Readonly<Record<string, readonly string[]>>;
  editions: readonly MatchEdition[];
  copies: readonly MatchCopy[];
  series: readonly string[];
  seriesPosition: string | null;
  updatedAt: string;
}
export interface CatalogueSnapshot {
  works: readonly MatchWork[];
  /** All ebooks, including decided rows: needed for shared ids, frequency and duplicates. */
  ebooks: readonly MatchEbook[];
  authors: readonly MatchAuthor[];
  ebookLocationId: string | null;
  /** Loader-proven active digital locations for explicit copy selection. */
  digitalLocationIds?: readonly string[];
}
export interface NewEditionEffect {
  title: string;
  subtitle: string | null;
  language: string;
  isbn13: string | null;
  publisher: string | null;
  publicationYear: number | null;
  metadataSource: "ebook";
  coverSourceKey: string | null;
}
export interface LinkEffect {
  workId: string;
  rule: EditionRule;
  editionId: string | null;
  instanceId: string | null;
  movedFromEditionId: string | null;
  newEdition: NewEditionEffect | null;
  newCopy: {
    locationId: string;
    format: "epub" | "pdf" | "ebook";
    fileSizeBytes: number;
    status: "available";
  } | null;
  missing: readonly string[];
  ambiguities: readonly Reason[];
  ready: boolean;
  /** An effect has no ids for new rows and is never an executable database plan. */
  text: string;
}
export interface PairScore {
  workId: string;
  weightBits: number;
  probability: number;
  titleSimilarity: number;
  titleExact: boolean;
  authorLevel: AuthorLevel;
  identifierEditions: readonly string[];
  identifierMethods: readonly ("isbn" | "identifier")[];
  identifierConflict: boolean;
  flags: readonly MatchFlag[];
  vetoes: readonly Reason[];
  reasons: readonly Reason[];
  components: Readonly<Record<string, number>>;
}
export interface MatchCandidate extends PairScore {
  rank: number;
  marginBits: number | null;
  effect: LinkEffect;
}
export interface MatchResult {
  ebookId: string;
  fingerprint: string;
  modelVersion: number;
  tier: MatchTier | null;
  skipped: "linked" | "unchanged_decision" | null;
  /** Model eligibility only. Calibration, source guards and explicit apply authorization are separate. */
  autoLink: boolean;
  duplicateOfId: string | null;
  flags: readonly MatchFlag[];
  reasons: readonly Reason[];
  candidates: readonly MatchCandidate[];
}
/** Later writers must bind this identity to both the committed provenance and reserved undo entry. */
export interface MatchOperationIdentity {
  version: 1;
  operationId: string;
  runId: string;
  planSha256: string;
  targetDatabase: string;
}
