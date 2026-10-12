import { isEbookFileDownloadable, isEbookFileNativeReadable } from "./conditions";
import { ebookReadHref, type LibraryEbook, type EbookDetail } from "./library-queries";
import { formatRank } from "./formats";

/** Public metadata allowlist: no storage keys, source paths, reports, positions or signed URLs. */
export function publicEbookDTO(ebook: LibraryEbook) {
  const active = ebook.matchState !== "excluded";
  const readable = active ? ebookReadHref(ebook) : null;
  return {
    id: ebook.id, title: ebook.title, subtitle: ebook.subtitle, authors: [...ebook.authors],
    language: ebook.language, matchState: ebook.matchState,
    formats: [...new Set(ebook.files.filter((file) => active && isEbookFileDownloadable(file)).map((file) => file.format))]
      .sort((a, b) => formatRank(a) - formatRank(b) || a.localeCompare(b)),
    readable: readable !== null, readerPath: readable,
    files: ebook.files.map((file) => ({ id: file.id, format: file.format, sizeBytes: file.sizeBytes,
      status: file.status, drm: file.drm, readable: active && isEbookFileNativeReadable(file),
      downloadable: active && isEbookFileDownloadable(file) })),
  };
}
export function publicEbookDetailDTO(ebook: EbookDetail) {
  return { ...publicEbookDTO(ebook), description: ebook.description, series: ebook.series,
    seriesIndex: ebook.seriesIndex, publisher: ebook.publisher, publicationYear: ebook.publicationYear,
    isbns: [...ebook.isbns], identifiers: Object.fromEntries(
      ["asin", "goodreads", "google", "openlibrary", "oclc", "doi", "uuid"]
        .filter((key) => Array.isArray(ebook.identifiers[key]))
        .map((key) => [key, ebook.identifiers[key].filter((value) => typeof value === "string")]),
    ),
    linkedCopy: ebook.matchState === "linked" && ebook.instanceId ? {
      instanceId: ebook.instanceId, editionId: ebook.editionId, editionPublisher: ebook.editionPublisher,
      editionYear: ebook.editionYear, workSlug: ebook.workSlug, workTitle: ebook.workTitle,
    } : null };
}
