import { existsSync, readFileSync, statSync } from "node:fs";
import { parseOpf } from "../ingest/inspect/opf";
import { SIDECAR_NAME } from "../ingest/group";
import { cleanDescription, publishedYearOf } from "../ingest/metadata";
import { normalizeLanguage } from "@/lib/utils/language";
import { normalizeSearchText } from "@/lib/utils/search-text";
import type { FileMetadata } from "../ingest/inspect/types";
import { libraryPath, type CalibreBook, type DriftBook, type DriftField } from "./library";

/*
 * Drift (SLN-656): Calibre writes each book's metadata.opf beside its files,
 * but only now and then, so an OPF can lag behind metadata.db. Each OPF is
 * compared with the snapshot field by field. Where they differ the snapshot
 * wins; the report only counts and names the books.
 */

/** Identifier types Calibre adds for itself: never a difference */
const OWN_SCHEMES = new Set(["uuid", "calibre", "library", "unknown"]);
/** An OPF written this long before the book's last change still counts as current */
const OLDER_SLACK_MS = 2000;

const same = (a: string | null | undefined, b: string | null | undefined) => normalizeSearchText(a ?? "") === normalizeSearchText(b ?? "");
const sameSet = (a: string[], b: string[]) => {
  const x = new Set(a.map((v) => normalizeSearchText(v)));
  const y = new Set(b.map((v) => normalizeSearchText(v)));
  return x.size === y.size && [...x].every((v) => y.has(v));
};
const day = (date: string | null | undefined) => (publishedYearOf(date) === null ? null : (date ?? "").slice(0, 10));

/** The fields where an OPF says something else than the snapshot */
export function driftFields(book: CalibreBook, opf: FileMetadata): DriftField[] {
  const fields: DriftField[] = [];
  const authors = (opf.authors ?? []).filter((a) => !a.role || a.role === "aut").map((a) => a.name);
  if (!same(book.title, opf.title)) fields.push("title");
  if (authors.length !== book.authors.length || authors.some((name, i) => !same(name, book.authors[i].name))) fields.push("authors");
  if (!same(book.series, opf.series)) fields.push("series");
  else if (book.series && (book.seriesIndex ?? 1) !== (opf.seriesIndex ?? 1)) fields.push("seriesIndex");
  if (!same(book.publisher, opf.publisher)) fields.push("publisher");
  if (normalizeLanguage(book.languages[0]) !== normalizeLanguage(opf.language)) fields.push("language");
  const ids = (list: { scheme: string; value: string }[]) => list.filter((i) => !OWN_SCHEMES.has(i.scheme.toLowerCase())).map((i) => `${i.scheme.toLowerCase()}:${i.value.trim()}`);
  if (!sameSet(ids(book.identifiers.map((i) => ({ scheme: i.type, value: i.value }))), ids(opf.identifiers ?? []))) fields.push("identifiers");
  if (!sameSet(book.tags, opf.subjects ?? [])) fields.push("tags");
  if ((cleanDescription(book.description) ?? "") !== (cleanDescription(opf.description) ?? "")) fields.push("description");
  if (day(book.pubdate) !== day(opf.date)) fields.push("date");
  return fields;
}

/** Each book's OPF against the snapshot; only books that drift are listed. An OPF outside the library is never read. */
export function driftReport(root: string, books: CalibreBook[]): DriftBook[] {
  const drift: DriftBook[] = [];
  for (const book of books) {
    const file = libraryPath(root, `${book.path}/${SIDECAR_NAME}`);
    if (!file) continue;
    if (!existsSync(file)) {
      drift.push({ bookId: book.id, path: book.path, missing: true, older: false, fields: [] });
      continue;
    }
    let fields: DriftField[];
    try {
      fields = driftFields(book, parseOpf(readFileSync(file, "utf8")).metadata);
    } catch {
      fields = ["unreadable"];
    }
    const changed = book.lastModified ? Date.parse(book.lastModified) : null;
    const older = changed !== null && statSync(file).mtimeMs + OLDER_SLACK_MS < changed;
    if (older || fields.length) drift.push({ bookId: book.id, path: book.path, missing: false, older, fields });
  }
  return drift;
}
