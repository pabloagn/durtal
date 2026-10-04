/**
 * One record from a metadata source, cleaned for Match (task 0184). Values a
 * source gets wrong (an ISBN with a bad check digit, a year 0, 99999 pages,
 * "Kindle Edition" as a binding, an unknown language) become null, so the
 * preview never offers them.
 */
import { normalizeLanguage } from "@/lib/utils/language";
import { normalizeBinding } from "@/lib/utils/binding";
import { stripControlChars, stripHtmlToText } from "@/lib/utils/sanitize";
import type { IsbndbBook } from "@/lib/api/isbndb";
import { extractIsbn, getBestCover } from "@/lib/api/google-books";
import {
  isbn10To13,
  isbn13To10,
  validIsbn10,
  validIsbn13,
  type MatchCandidate,
} from "@/lib/match/plan";

export const MATCH_SOURCES = ["isbndb", "google_books", "open_library"] as const;
export type MatchSource = (typeof MATCH_SOURCES)[number];

export const MATCH_SOURCE_LABEL: Record<MatchSource, string> = {
  isbndb: "ISBNdb",
  google_books: "Google Books",
  open_library: "Open Library",
};

export interface SourceRecord extends MatchCandidate {
  /** Identifiers of the source record, saved with any accepted field */
  googleBooksId?: string;
  openLibraryKey?: string;
}

interface RawRecord {
  title?: unknown;
  subtitle?: unknown;
  publisher?: unknown;
  isbn13?: unknown;
  isbn10?: unknown;
  year?: unknown;
  pages?: unknown;
  language?: unknown;
  binding?: unknown;
  description?: unknown;
  coverUrl?: unknown;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = stripControlChars(value).replace(/\s+/g, " ").trim();
  return clean || null;
}

function year(value: unknown): number | null {
  const match = String(value ?? "").match(/\b(1[4-9]\d\d|20\d\d)\b/);
  const y = match ? Number(match[1]) : NaN;
  return y <= new Date().getFullYear() + 1 ? y : null;
}

function pages(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 10000 ? n : null;
}

function cover(value: unknown): string | null {
  const url = text(value)?.replace(/^http:\/\//, "https://");
  return url && /^https:\/\/[^\s]+$/.test(url) ? url : null;
}

/** A raw record from any source, cleaned */
export function cleanRecord(raw: RawRecord): MatchCandidate {
  let isbn13 = validIsbn13(text(raw.isbn13));
  let isbn10 = validIsbn10(text(raw.isbn10));
  // Sources mix the two columns up; each ISBN-10 has one ISBN-13
  if (!isbn13 && validIsbn13(text(raw.isbn10)))
    isbn13 = validIsbn13(text(raw.isbn10));
  if (!isbn10 && validIsbn10(text(raw.isbn13)))
    isbn10 = validIsbn10(text(raw.isbn13));
  if (!isbn13 && isbn10) isbn13 = isbn10To13(isbn10);
  if (!isbn10 && isbn13) isbn10 = isbn13To10(isbn13);
  if (isbn13 && isbn10 && isbn10To13(isbn10) !== isbn13) isbn10 = null;
  return {
    title: text(raw.title),
    subtitle: text(raw.subtitle),
    publisher: text(raw.publisher),
    isbn13,
    isbn10,
    publicationYear: year(raw.year),
    pageCount: pages(raw.pages),
    language: normalizeLanguage(text(raw.language)),
    binding: normalizeBinding(text(raw.binding)),
    // Plain text with its paragraphs, as the add-book wizard stores it
    description:
      typeof raw.description === "string"
        ? stripHtmlToText(stripControlChars(raw.description)) || null
        : null,
    coverUrl: cover(raw.coverUrl),
  };
}

/** A fresh signal per request: one made at load time would expire for all */
const timeout = () => ({ signal: AbortSignal.timeout(10000) });

async function fromGoogleBooks(id: string): Promise<SourceRecord> {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  const res = await fetch(
    `https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(id)}${key ? `?key=${key}` : ""}`,
    timeout(),
  );
  if (!res.ok) throw new Error("Could not fetch from Google Books");
  const info = ((await res.json()).volumeInfo ?? {}) as Record<string, unknown>;
  const ids = info.industryIdentifiers as Parameters<typeof extractIsbn>[0];
  return {
    ...cleanRecord({
      title: info.title,
      subtitle: info.subtitle,
      publisher: info.publisher,
      isbn13: extractIsbn(ids, "ISBN_13"),
      isbn10: extractIsbn(ids, "ISBN_10"),
      year: info.publishedDate,
      pages: info.pageCount,
      language: info.language,
      description: info.description,
      coverUrl: getBestCover(
        info.imageLinks as Parameters<typeof getBestCover>[0],
      ),
    }),
    googleBooksId: id,
  };
}

async function fromOpenLibrary(key: string): Promise<SourceRecord> {
  // "/works/OL123W" or "/books/OL123M"
  const path = key.startsWith("/") ? key : `/${key}`;
  if (!/^\/(works|books)\/OL\d+[WM]$/.test(path))
    throw new Error("Not an Open Library record");
  const res = await fetch(`https://openlibrary.org${path}.json`, timeout());
  if (!res.ok) throw new Error("Could not fetch from Open Library");
  const d = await res.json();
  const description =
    typeof d.description === "string" ? d.description : d.description?.value;
  const coverId = d.covers?.find((c: number) => c > 0);
  return {
    ...cleanRecord({
      title: d.title,
      subtitle: d.subtitle,
      publisher: d.publishers?.[0],
      isbn13: d.isbn_13?.[0],
      isbn10: d.isbn_10?.[0],
      year: d.publish_date,
      pages: d.number_of_pages,
      // "/languages/eng" → "eng"
      language: String(d.languages?.[0]?.key ?? "").split("/").pop(),
      binding: d.physical_format,
      description,
      coverUrl: coverId
        ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`
        : undefined,
    }),
    openLibraryKey: key,
  };
}

/** An ISBNdb record, cleaned */
export function isbndbRecord(book: IsbndbBook): MatchCandidate {
  return cleanRecord({
    title: book.title,
    publisher: book.publisher,
    isbn13: book.isbn13,
    isbn10: book.isbn10,
    year: book.date_published,
    pages: book.pages,
    language: book.language,
    binding: book.binding,
    description: book.synopsis ?? book.excerpt,
    coverUrl: book.image,
  });
}

async function fromIsbndb(isbn: string): Promise<SourceRecord> {
  const { getIsbndbBook } = await import("@/lib/api/isbndb");
  const book = await getIsbndbBook(isbn);
  if (!book) throw new Error("Could not fetch from ISBNdb");
  return isbndbRecord(book);
}

/** The record a search result points to, read again from its source */
export async function fetchSourceRecord(
  source: string,
  sourceId: string,
): Promise<SourceRecord> {
  if (source === "google_books") return fromGoogleBooks(sourceId);
  if (source === "open_library") return fromOpenLibrary(sourceId);
  if (source === "isbndb") return fromIsbndb(sourceId);
  throw new Error(`Unsupported source: ${source}`);
}
