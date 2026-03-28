interface OpenLibraryDoc {
  key: string;
  title: string;
  subtitle?: string;
  author_name?: string[];
  author_key?: string[];
  first_publish_year?: number;
  publisher?: string[];
  isbn?: string[];
  language?: string[];
  number_of_pages_median?: number;
  subject?: string[];
  cover_i?: number;
  edition_count?: number;
}

interface OpenLibrarySearchResponse {
  numFound: number;
  docs: OpenLibraryDoc[];
}

export interface OpenLibraryResult {
  source: "open_library";
  sourceId: string;
  title: string;
  subtitle?: string;
  authors: string[];
  authorKeys: string[];
  publisher?: string;
  publishedYear?: number;
  isbn13?: string;
  isbn10?: string;
  pageCount?: number;
  subjects: string[];
  coverUrl?: string;
  languages: string[];
  editionCount: number;
}

const SEARCH_URL = "https://openlibrary.org/search.json";
const COVERS_URL = "https://covers.openlibrary.org/b";

function extractIsbns(isbns?: string[]): { isbn13?: string; isbn10?: string } {
  if (!isbns) return {};
  const isbn13 = isbns.find((i) => i.length === 13);
  const isbn10 = isbns.find((i) => i.length === 10);
  return { isbn13, isbn10 };
}

function docToResult(doc: OpenLibraryDoc): OpenLibraryResult {
  const { isbn13, isbn10 } = extractIsbns(doc.isbn);
  return {
    source: "open_library",
    sourceId: doc.key,
    title: doc.title,
    subtitle: doc.subtitle,
    authors: doc.author_name ?? [],
    authorKeys: doc.author_key ?? [],
    publisher: doc.publisher?.[0],
    publishedYear: doc.first_publish_year,
    isbn13,
    isbn10,
    pageCount: doc.number_of_pages_median,
    subjects: (doc.subject ?? []).slice(0, 10),
    coverUrl: doc.cover_i
      ? `${COVERS_URL}/id/${doc.cover_i}-L.jpg`
      : undefined,
    languages: doc.language ?? [],
    editionCount: doc.edition_count ?? 0,
  };
}

export async function searchOpenLibrary(
  query: string,
  limit = 10,
): Promise<OpenLibraryResult[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    fields:
      "key,title,subtitle,author_name,author_key,first_publish_year,publisher,isbn,language,number_of_pages_median,subject,cover_i,edition_count",
  });

  const res = await fetch(`${SEARCH_URL}?${params}`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) return [];

  const data: OpenLibrarySearchResponse = await res.json();
  return data.docs.map(docToResult);
}

export async function searchOpenLibraryByIsbn(
  isbn: string,
): Promise<OpenLibraryResult | null> {
  const params = new URLSearchParams({
    isbn: isbn,
    limit: "1",
    fields:
      "key,title,subtitle,author_name,author_key,first_publish_year,publisher,isbn,language,number_of_pages_median,subject,cover_i,edition_count",
  });

  const res = await fetch(`${SEARCH_URL}?${params}`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) return null;

  const data: OpenLibrarySearchResponse = await res.json();
  return data.docs[0] ? docToResult(data.docs[0]) : null;
}
