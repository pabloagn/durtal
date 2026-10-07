import type { EbookFormat } from "../../formats";
import type { TextSource } from "../../text/extract";

/** One creator as the file names it */
export interface FileAuthor {
  name: string;
  /** The file's sort form ("Borges, Jorge Luis"), when it gives one */
  fileAs?: string | null;
  /** MARC relator code ("aut", "trl", "edt"); null when the file gives none */
  role?: string | null;
}

/** What a file says about itself, before merging (metadata.ts) */
export interface FileMetadata {
  title?: string | null;
  subtitle?: string | null;
  authors?: FileAuthor[];
  /** As written: "en", "eng", "en-GB", "English" */
  language?: string | null;
  /** Every identifier with its scheme, lower case: isbn, asin, uuid, google, goodreads, doi, mobi-asin, or a library's own */
  identifiers?: { scheme: string; value: string }[];
  publisher?: string | null;
  /** As written: "1951", "1951-03-01", "2001-01-01T00:00:00+00:00" */
  date?: string | null;
  /** HTML or plain text, uncleaned */
  description?: string | null;
  subjects?: string[];
  series?: string | null;
  seriesIndex?: number | null;
}

export type DrmKind = "adobe-adept" | "kindle" | "readium-lcp" | "apple-fairplay" | "pdf-password" | "unknown";

/** A file's cover image, read only when covers are made (a PDF's first page is rendered then) */
export interface CoverRef {
  kind: "bytes";
  load: () => Promise<Uint8Array>;
  mediaType?: string | null;
}

/** The facts the reader's manifest carries (manifest.ts) */
export interface ManifestFacts {
  zip?: { cdOffset: number; cdSize: number; entries: number; opfPath: string | null };
  pdf?: { pages: number; linearized: boolean };
  epub?: { version: string; fixedLayout: boolean; direction: "ltr" | "rtl" | "default"; hasPageList: boolean };
}

export interface Inspection {
  format: EbookFormat;
  metadata: FileMetadata;
  drm: DrmKind | null;
  /** A damaged or unreadable file, in plain words: stored quarantined, never served */
  problem: string | null;
  cover: CoverRef | null;
  manifest: ManifestFacts;
  /** What extractBodyText reads; null for DRM and damaged files */
  text: TextSource | null;
  /** Format facts kept in ebook_files.metadata (EPUB nav, NCX, page list) */
  details: Record<string, unknown>;
  /** Releases what the cover loader still holds (a PDF document); called once covers are made */
  close?: () => Promise<void>;
}

export const emptyInspection = (format: EbookFormat, extra: Partial<Inspection> = {}): Inspection => ({
  format,
  metadata: {},
  drm: null,
  problem: null,
  cover: null,
  manifest: {},
  text: null,
  details: {},
  ...extra,
});
