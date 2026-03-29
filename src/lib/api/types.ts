/**
 * Unified search result type produced by both Google Books and Open Library adapters.
 * Backward-compatible with the wizard's existing SearchResult usage.
 */
export interface SearchResult {
  source: "google_books" | "open_library";
  sourceId: string;
  title: string;
  subtitle?: string;
  authors: string[];
  publisher?: string;
  publicationYear?: number;
  publishedDate?: string;
  description?: string;
  isbn13?: string;
  isbn10?: string;
  pageCount?: number;
  categories: string[];
  coverUrl?: string;
  language?: string;
  languages?: string[];
  editionCount?: number;
  /** Internal: Open Library author keys for cross-reference */
  _authorKeys?: string[];
  /** Internal: computed ranking score */
  _score?: number;
}
