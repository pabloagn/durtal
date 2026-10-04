import { parseYear } from "@/lib/utils/years";
import type { SearchResult } from "./types";
import { reportSearchFailure } from "./search-diagnostics";
import { GoogleBooksQuotaError, googleBooksFetch } from "./google-books-quota";
import { serverEnv } from "@/lib/env";

interface GoogleBooksVolume {
  id: string;
  volumeInfo: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    industryIdentifiers?: { type: string; identifier: string }[];
    pageCount?: number;
    categories?: string[];
    imageLinks?: {
      smallThumbnail?: string;
      thumbnail?: string;
      small?: string;
      medium?: string;
      large?: string;
    };
    language?: string;
    previewLink?: string;
  };
}

interface GoogleBooksResponse {
  totalItems: number;
  items?: GoogleBooksVolume[];
}

const BASE_URL = "https://www.googleapis.com/books/v1/volumes";
const FETCH_TIMEOUT_MS = 8000;

export function extractIsbn(
  identifiers?: { type: string; identifier: string }[],
  type: string = "ISBN_13",
): string | undefined {
  return identifiers?.find((id) => id.type === type)?.identifier;
}

export function getBestCover(
  imageLinks?: GoogleBooksVolume["volumeInfo"]["imageLinks"],
): string | undefined {
  if (!imageLinks) return undefined;
  const url =
    imageLinks.large ??
    imageLinks.medium ??
    imageLinks.small ??
    imageLinks.thumbnail ??
    imageLinks.smallThumbnail;
  return url?.replace("http://", "https://");
}

function volumeToResult(volume: GoogleBooksVolume): SearchResult {
  const info = volume.volumeInfo;
  return {
    source: "google_books",
    sourceId: volume.id,
    title: info.title ?? "Untitled",
    subtitle: info.subtitle,
    authors: info.authors ?? [],
    publisher: info.publisher,
    publishedDate: info.publishedDate,
    publicationYear: parseYear(info.publishedDate),
    description: info.description,
    isbn13: extractIsbn(info.industryIdentifiers, "ISBN_13"),
    isbn10: extractIsbn(info.industryIdentifiers, "ISBN_10"),
    pageCount: info.pageCount,
    categories: info.categories ?? [],
    coverUrl: getBestCover(info.imageLinks),
    language: info.language,
  };
}

export async function searchGoogleBooks(
  query: string,
  maxResults = 10,
): Promise<SearchResult[]> {
  const apiKey = serverEnv().GOOGLE_BOOKS_API_KEY;
  const params = new URLSearchParams({
    q: query,
    maxResults: String(maxResults),
    printType: "books",
    ...(apiKey ? { key: apiKey } : {}),
  });

  let res: Response;
  try {
    res = await googleBooksFetch(
      `${BASE_URL}?${params}`,
      { next: { revalidate: 3600 } },
      FETCH_TIMEOUT_MS,
    );
  } catch (error) {
    // Over the quota: no results from this source; the search says why
    // (`googleBooksOverQuota`)
    if (error instanceof GoogleBooksQuotaError) return [];
    throw error;
  }
  if (!res.ok) {
    reportSearchFailure("google_books", res.status);
    return [];
  }

  const data: GoogleBooksResponse = await res.json();
  return (data.items ?? []).map(volumeToResult);
}

export async function searchGoogleBooksByIsbn(
  isbn: string,
): Promise<SearchResult | null> {
  const results = await searchGoogleBooks(`isbn:${isbn}`, 1);
  return results[0] ?? null;
}

export async function searchGoogleBooksByAuthor(
  authorName: string,
  maxResults = 10,
): Promise<SearchResult[]> {
  return searchGoogleBooks(`inauthor:"${authorName}"`, maxResults);
}
