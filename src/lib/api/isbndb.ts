import type { SearchResult } from "./types";

interface IsbndbBook {
  title: string;
  isbn13: string;
  isbn10?: string;
  binding?: string;
  publisher?: string;
  language?: string;
  date_published?: string;
  pages?: number;
  image?: string;
  synopsis?: string;
  excerpt?: string;
  authors?: string[];
  subjects?: string[];
}

interface IsbndbBookResponse {
  book: IsbndbBook;
}

interface IsbndbSearchResponse {
  total: number;
  data: IsbndbBook[];
}

const BASE_URL = "https://api2.isbndb.com";
const FETCH_TIMEOUT_MS = 8000;

function getHeaders(): HeadersInit {
  const apiKey = process.env.ISBNDN_API_KEY;
  if (!apiKey) throw new Error("ISBNDN_API_KEY is not set");
  return {
    Authorization: apiKey,
    "Content-Type": "application/json",
  };
}

function parseYear(dateStr?: string): number | undefined {
  if (!dateStr) return undefined;
  const match = dateStr.match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : undefined;
}

function bookToResult(book: IsbndbBook): SearchResult {
  return {
    source: "isbndb",
    sourceId: book.isbn13 ?? book.isbn10 ?? "",
    title: book.title ?? "Untitled",
    authors: book.authors ?? [],
    publisher: book.publisher,
    publishedDate: book.date_published,
    publicationYear: parseYear(book.date_published),
    description: book.synopsis ?? book.excerpt,
    isbn13: book.isbn13,
    isbn10: book.isbn10,
    pageCount: book.pages,
    categories: (book.subjects ?? []).slice(0, 10),
    coverUrl: book.image || undefined,
    language: book.language,
  };
}

export async function searchIsbndbByIsbn(
  isbn: string,
): Promise<SearchResult | null> {
  const res = await fetch(`${BASE_URL}/book/${isbn}`, {
    headers: getHeaders(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    next: { revalidate: 3600 },
  });
  if (!res.ok) return null;

  const data: IsbndbBookResponse = await res.json();
  return data.book ? bookToResult(data.book) : null;
}

export async function searchIsbndb(
  query: string,
  maxResults = 10,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    pageSize: String(maxResults),
  });

  const res = await fetch(
    `${BASE_URL}/books/${encodeURIComponent(query)}?${params}`,
    {
      headers: getHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      next: { revalidate: 3600 },
    },
  );
  if (!res.ok) return [];

  const data: IsbndbSearchResponse = await res.json();
  return (data.data ?? []).map(bookToResult);
}

export async function searchIsbndbByAuthor(
  authorName: string,
  maxResults = 10,
): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    pageSize: String(maxResults),
    column: "author",
  });

  const res = await fetch(
    `${BASE_URL}/books/${encodeURIComponent(authorName)}?${params}`,
    {
      headers: getHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      next: { revalidate: 3600 },
    },
  );
  if (!res.ok) return [];

  const data: IsbndbSearchResponse = await res.json();
  return (data.data ?? []).map(bookToResult);
}
