import { createHash } from "node:crypto";

/*
 * The only builders of `readings.source_key` (and of the Up Next and note
 * keys of later steps). A key says where a record came from and keeps a
 * re-run from writing it twice; nothing writes one by hand (SLN-444). The
 * seed step's Python copy is checked against the same fixture
 * (src/__tests__/fixtures/reading/source-keys.json).
 */

/**
 * Text as keys compare it: Unicode NFKD, marks dropped, lower case, every run
 * of characters that are neither letters nor digits as one space, trimmed.
 */
export function normalizeKeyText(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** An ISBN as its digits only: Goodreads writes ="9780..."; a missing one is "" */
export function isbnDigits(isbn: string | null | undefined): string {
  return (isbn ?? "").replace(/\D/g, "");
}

/** The lowercase hex SHA-256 of the normalized parts joined with "|" */
export function keyHash(...parts: (string | null | undefined)[]): string {
  return createHash("sha256")
    .update(parts.map(normalizeKeyText).join("|"), "utf8")
    .digest("hex");
}

interface BookIdentity {
  bookId?: string | null;
  isbn13?: string | null;
  title: string;
  firstAuthor: string;
}

/** "<id>", else "isbn13:<digits>", else "title:<hash>": how Goodreads rows are told apart */
function goodreadsIdentity(b: BookIdentity) {
  const id = (b.bookId ?? "").replace(/\D/g, "");
  if (id) return id;
  const isbn = isbnDigits(b.isbn13);
  if (isbn) return `isbn13:${isbn}`;
  return `title:${keyHash(b.title, b.firstAuthor)}`;
}

/** The n-th read (1 for the first) of a Goodreads export row */
export function goodreadsReadingKey(b: BookIdentity, n: number) {
  return `goodreads:${goodreadsIdentity(b)}#${n}`;
}

/** The n-th read of a StoryGraph export row */
export function storygraphReadingKey(b: { title: string; firstAuthor: string; isbn13?: string | null }, n: number) {
  return `storygraph:${keyHash(b.title, b.firstAuthor, isbnDigits(b.isbn13))}#${n}`;
}

/** A read from the seed spreadsheet */
export function seedReadingKey(b: { title: string; firstAuthor: string }) {
  return `seed:${keyHash(b.title, b.firstAuthor)}`;
}

/** A reading exported from Durtal with no stored key */
export function durtalReadingKey(readingId: string) {
  return `durtal:${readingId}`;
}

/** A hand-made Durtal CSV row with neither a reading id nor a key: its trimmed cells, in column order */
export function durtalImportRowKey(cells: (string | null | undefined)[]) {
  const json = JSON.stringify(cells.map((c) => (c ?? "").trim()));
  return `durtal-import:${createHash("sha256").update(json, "utf8").digest("hex")}`;
}

/** The built-in reader's finished book (the backfill) */
export function readerReadingKey(calibreBookId: string) {
  return `reader:${calibreBookId}`;
}

/** Calibre's finished-date signal */
export function calibreReadingKey(calibreId: number | string) {
  return `calibre:${calibreId}`;
}

/** A Goodreads to-read row, for Up Next */
export function goodreadsToReadKey(b: BookIdentity) {
  return `goodreads-to-read:${goodreadsIdentity(b)}`;
}

/** A StoryGraph to-read row, for Up Next */
export function storygraphToReadKey(b: { title: string; firstAuthor: string; isbn13?: string | null }) {
  return `storygraph-to-read:${keyHash(b.title, b.firstAuthor, isbnDigits(b.isbn13))}`;
}

/** A Goodreads review or note, for the commonplace book */
export function goodreadsNoteKey(b: BookIdentity) {
  return `goodreads-note:${goodreadsIdentity(b)}`;
}
