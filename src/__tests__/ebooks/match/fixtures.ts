import { indexCatalogue } from "@/lib/ebooks/match/catalogue";
import type {
  CatalogueSnapshot,
  MatchAuthor,
  MatchCopy,
  MatchEbook,
  MatchEdition,
  MatchWork,
} from "@/lib/ebooks/match/types";

export const at = "2026-10-09T12:00:00.000Z";
export const author = (fields: Partial<MatchAuthor> = {}): MatchAuthor => ({
  id: "author-1",
  name: "André Breton",
  aliases: [],
  ...fields,
});
export const edition = (fields: Partial<MatchEdition> = {}): MatchEdition => ({
  id: "edition-1",
  workId: "work-1",
  title: "Nadja",
  language: "en",
  identifiers: {},
  metadataSource: "ebook",
  metadataLocked: false,
  updatedAt: at,
  ...fields,
});
export const copy = (fields: Partial<MatchCopy> = {}): MatchCopy => ({
  id: "copy-1",
  editionId: "edition-1",
  locationId: "ebooks-location",
  status: "available",
  linkedEbookId: null,
  updatedAt: at,
  ...fields,
});
export const work = (fields: Partial<MatchWork> = {}): MatchWork => ({
  id: "work-1",
  kind: "book",
  title: "Nadja",
  originalLanguage: "en",
  originalYear: 1928,
  catalogueStatus: "wanted",
  authors: [author()],
  editions: [],
  copies: [],
  series: [],
  seriesPosition: null,
  identifiers: {},
  updatedAt: at,
  ...fields,
});
export const ebook = (fields: Partial<MatchEbook> = {}): MatchEbook => ({
  id: "ebook-1",
  title: "Nadja",
  authors: ["Andre Breton"],
  language: "en",
  isbns: [],
  identifiers: {},
  files: [
    {
      id: "file-1",
      sha256: "a".repeat(64),
      format: "epub",
      sizeBytes: 1000,
      status: "stored",
      drm: null,
      availability: "native",
    },
  ],
  createdAt: at,
  updatedAt: at,
  instanceId: null,
  matchState: "pending",
  matchFingerprint: null,
  ...fields,
});
export const catalogue = (fields: Partial<CatalogueSnapshot> = {}) =>
  indexCatalogue({
    works: [work()],
    ebooks: [],
    authors: [author()],
    ebookLocationId: "ebooks-location",
    ...fields,
  });
