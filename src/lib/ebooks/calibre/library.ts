import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FileMetadata } from "../ingest/inspect/types";

/*
 * Joris's Calibre library as Durtal reads it (SLN-656): a snapshot of its
 * metadata.db, taken once from a copy, that every later step uses. Durtal
 * never writes to the library and never needs Calibre installed. Paths are
 * kept relative to the library folder; the library is known by the uuid in
 * its metadata.db and each book by its Calibre uuid, so the same drive at
 * another mount point gives the same identities.
 */

export const SNAPSHOT_VERSION = 1;
export const METADATA_DB = "metadata.db";

export interface CalibreFormat {
  /** Lower case, as the file's extension: "epub", "pdf", "azw3" */
  format: string;
  /** Calibre's recorded size in bytes */
  size: number;
  /** Relative to the library folder, with "/" separators */
  path: string;
}

/** A custom column's value: text, a list of text, a number, a yes/no, a date, or a series entry */
export type CalibreCustomValue = string | string[] | number | boolean | { series: string; index: number | null } | null;

export interface CalibreBook {
  id: number;
  /** Lower case */
  uuid: string;
  title: string;
  titleSort: string | null;
  /** In Calibre's order, with each author's sort name */
  authors: { name: string; sort: string | null }[];
  authorSort: string | null;
  series: string | null;
  seriesIndex: number | null;
  publisher: string | null;
  /** ISO 8601; null when Calibre has none (its year-101 placeholder) */
  pubdate: string | null;
  /** As Calibre stores them: ISO 639-2 codes, in order */
  languages: string[];
  /** Every identifier with its type, as Calibre stores them ("isbn", "amazon", "goodreads") */
  identifiers: { type: string; value: string }[];
  tags: string[];
  /** Stars, 0.5 to 5 (Calibre stores 1 to 10); null when unrated */
  rating: number | null;
  /** Calibre's comments, HTML as stored */
  description: string | null;
  hasCover: boolean;
  /** Relative to the library folder; set when hasCover */
  coverPath: string | null;
  /** The book's folder, relative to the library folder */
  path: string;
  /** Date added, ISO 8601 */
  added: string | null;
  lastModified: string | null;
  formats: CalibreFormat[];
  /** Custom columns by label (without the "#"), only those with a value */
  custom: Record<string, CalibreCustomValue>;
}

export interface CalibreColumn {
  label: string;
  name: string;
  /** Calibre's datatype: text, comments, series, enumeration, rating, bool, int, float, datetime, composite */
  type: string;
  isMultiple: boolean;
}

/** A field where an OPF and the snapshot differ; "unreadable" is an OPF that cannot be parsed */
export type DriftField = "title" | "authors" | "series" | "seriesIndex" | "publisher" | "language" | "identifiers" | "tags" | "description" | "date" | "unreadable";

export interface DriftBook {
  bookId: number;
  path: string;
  /** No metadata.opf in the book's folder */
  missing: boolean;
  /** The OPF was written before the book last changed in Calibre */
  older: boolean;
  /** The fields where the OPF says something else; the snapshot is what Durtal takes */
  fields: DriftField[];
}

export interface CalibreSnapshot {
  v: typeof SNAPSHOT_VERSION;
  takenAt: string;
  host: string;
  library: {
    /** The uuid in metadata.db's library_id table: the library's identity */
    id: string;
    /** Where it was mounted when the snapshot was taken: lineage only */
    path: string;
    /** The drive's volume UUID and mount point, when the system says */
    volumeUuid: string | null;
    mountPoint: string | null;
  };
  metadataDb: {
    sha256: string;
    size: number;
    mtimeMs: number;
  };
  columns: CalibreColumn[];
  books: CalibreBook[];
  files: {
    /** Formats metadata.db lists that are not on disk */
    missing: { bookId: number; path: string }[];
    /** Files in the library that metadata.db does not list */
    extra: string[];
  };
  drift: DriftBook[];
}

/** The SHA-256 of a file, read as a stream */
export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/** A path relative to the library folder, on this machine */
export const libraryPath = (root: string, relative: string) => path.join(root, ...relative.split("/"));

/** A snapshot file and the SHA-256 of its bytes */
export function readSnapshot(file: string): { snapshot: CalibreSnapshot; sha256: string } {
  if (!existsSync(file)) throw new Error(`${file} does not exist: take a snapshot with pnpm ebooks:calibre-snapshot.`);
  const bytes = readFileSync(file);
  const snapshot = JSON.parse(bytes.toString("utf8")) as CalibreSnapshot;
  if (snapshot.v !== SNAPSHOT_VERSION || !snapshot.library?.id || !Array.isArray(snapshot.books))
    throw new Error(`${file} is not a Calibre snapshot of this version: take a new one.`);
  return { snapshot, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** What a plan records of the snapshot it was made from */
export interface CalibreBinding {
  snapshot: string;
  snapshotSha256: string;
  libraryId: string;
  /** The library folder the plan read */
  libraryPath: string;
  metadataDbSha256: string;
}

/**
 * Throws unless the library's metadata.db is still the one the snapshot
 * copied: a library edited in Calibre since is planned again from a new
 * snapshot. Reads the file only.
 */
export async function checkCalibreSource(binding: CalibreBinding, nothing = "Nothing written."): Promise<void> {
  const db = path.join(binding.libraryPath, METADATA_DB);
  if (!existsSync(binding.libraryPath)) throw new Error(`The Calibre library is not mounted at ${binding.libraryPath}. ${nothing}`);
  if (!existsSync(db)) throw new Error(`There is no ${METADATA_DB} in ${binding.libraryPath}. ${nothing}`);
  if ((await sha256File(db)) !== binding.metadataDbSha256)
    throw new Error(`The Calibre library changed since its snapshot: take a new snapshot (pnpm ebooks:calibre-snapshot) and plan again. ${nothing}`);
}

/** What Calibre writes when it has no title or author: never a value */
const CALIBRE_UNKNOWN = "unknown";

/** A Calibre book's fields as file metadata, the top layer of what the planner merges */
export function calibreFileMetadata(book: CalibreBook): FileMetadata {
  const known = (value: string | null) => (value && value.trim().toLowerCase() !== CALIBRE_UNKNOWN ? value : null);
  return {
    title: known(book.title),
    authors: book.authors.filter((a) => known(a.name)).map((a) => ({ name: a.name, fileAs: a.sort, role: "aut" })),
    language: book.languages[0] ?? null,
    identifiers: book.identifiers.map((i) => ({ scheme: i.type.toLowerCase(), value: i.value })),
    publisher: book.publisher,
    date: book.pubdate,
    description: book.description,
    subjects: book.tags,
    series: book.series,
    seriesIndex: book.series ? book.seriesIndex : null,
  };
}

/** What ebook_files.metadata keeps under `calibre`: the book's fields and its lineage, without the other formats */
export function calibreLineage(book: CalibreBook, format: CalibreFormat, binding: Pick<CalibreBinding, "libraryId" | "snapshotSha256">) {
  const { formats: _formats, ...fields } = book;
  return { libraryId: binding.libraryId, bookId: book.id, snapshotSha256: binding.snapshotSha256, ...fields, format };
}
