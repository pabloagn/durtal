import type { SearchResult } from "./types";
import {
  classifyQuery,
  type ClassifiedQuery,
} from "./query-classifier";
import {
  searchGoogleBooks,
  searchGoogleBooksByIsbn,
  searchGoogleBooksByAuthor,
} from "./google-books";
import {
  searchOpenLibrary,
  searchOpenLibraryByIsbn,
  searchOpenLibraryByAuthor,
  searchOpenLibrarySplit,
} from "./open-library";

// ── Normalization ──────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-z0-9\s]/g, "") // strip punctuation
    .replace(/\s+/g, " ")
    .trim();
}

// ── Deduplication ──────────────────────────────────────────────────────────────

function metadataRichness(r: SearchResult): number {
  let score = 0;
  if (r.coverUrl) score += 4;
  if (r.description) score += 3;
  if (r.isbn13) score += 2;
  if (r.pageCount) score += 1;
  if (r.publisher) score += 1;
  if (r.publicationYear) score += 1;
  if (r.editionCount && r.editionCount > 0) score += 1;
  return score;
}

function mergeResults(a: SearchResult, b: SearchResult): SearchResult {
  const [primary, secondary] =
    metadataRichness(a) >= metadataRichness(b) ? [a, b] : [b, a];

  return {
    ...primary,
    coverUrl: primary.coverUrl ?? secondary.coverUrl,
    description: primary.description ?? secondary.description,
    isbn13: primary.isbn13 ?? secondary.isbn13,
    isbn10: primary.isbn10 ?? secondary.isbn10,
    pageCount: primary.pageCount ?? secondary.pageCount,
    publisher: primary.publisher ?? secondary.publisher,
    publicationYear: primary.publicationYear ?? secondary.publicationYear,
    editionCount: Math.max(
      primary.editionCount ?? 0,
      secondary.editionCount ?? 0,
    ),
    categories: [
      ...new Set([...primary.categories, ...secondary.categories]),
    ],
  };
}

function deduplicateResults(results: SearchResult[]): SearchResult[] {
  // Pass 1: group by ISBN
  const isbnMap = new Map<string, SearchResult>();
  const noIsbn: SearchResult[] = [];

  for (const r of results) {
    const isbn = r.isbn13 ?? r.isbn10;
    if (isbn) {
      const existing = isbnMap.get(isbn);
      isbnMap.set(isbn, existing ? mergeResults(existing, r) : r);
    } else {
      noIsbn.push(r);
    }
  }

  // Pass 2: deduplicate by normalized title + first author
  const titleAuthorMap = new Map<string, SearchResult>();
  const deduped: SearchResult[] = [...isbnMap.values()];

  for (const r of deduped) {
    const key = `${normalize(r.title)}::${normalize(r.authors[0] ?? "")}`;
    titleAuthorMap.set(key, r);
  }

  for (const r of noIsbn) {
    const key = `${normalize(r.title)}::${normalize(r.authors[0] ?? "")}`;
    const existing = titleAuthorMap.get(key);
    if (existing) {
      const merged = mergeResults(existing, r);
      titleAuthorMap.set(key, merged);
      const idx = deduped.findIndex(
        (d) =>
          `${normalize(d.title)}::${normalize(d.authors[0] ?? "")}` === key,
      );
      if (idx >= 0) deduped[idx] = merged;
    } else {
      titleAuthorMap.set(key, r);
      deduped.push(r);
    }
  }

  return deduped;
}

// ── Ranking ────────────────────────────────────────────────────────────────────

function scoreResult(result: SearchResult, query: ClassifiedQuery): number {
  let score = 0;

  const normalizedQuery = normalize(query.normalized);
  const queryWords = normalizedQuery
    .split(/\s+/)
    .filter((w) => w.length > 1);
  const normalizedTitle = normalize(result.title);
  const normalizedAuthors = result.authors.map((a) => normalize(a));
  const allAuthorText = normalizedAuthors.join(" ");

  // 1. Metadata completeness (0-30)
  if (result.coverUrl) score += 10;
  if (result.description) score += 5;
  if (result.isbn13) score += 5;
  if (result.pageCount) score += 3;
  if (result.publisher) score += 3;
  if (result.publicationYear) score += 2;
  if (result.language) score += 2;

  // 2. Language preference (0-25)
  const lang = result.language?.toLowerCase();
  if (lang === "en" || lang === "eng") {
    score += 25;
  } else if (lang && lang !== "en" && lang !== "eng") {
    const hasNonLatin = /[^\u0000-\u024F\u1E00-\u1EFF]/.test(result.title);
    score += hasNonLatin ? -20 : -5;
  }

  // 3. Edition count — popularity signal (0-15)
  if (result.editionCount && result.editionCount > 0) {
    score += Math.min(15, Math.log2(result.editionCount + 1) * 3);
  }

  // 4. Word-level relevance scoring (0-75)
  let titleWordHits = 0;
  let authorWordHits = 0;
  let matchedQueryWords = 0;

  for (const qw of queryWords) {
    const inTitle = normalizedTitle.includes(qw);
    const inAuthor = allAuthorText.includes(qw);
    if (inTitle) titleWordHits++;
    if (inAuthor) authorWordHits++;
    if (inTitle || inAuthor) matchedQueryWords++;
  }

  if (queryWords.length > 0) {
    const matchRatio = matchedQueryWords / queryWords.length;
    if (matchRatio === 1) {
      score += 40; // all query words found
    } else {
      score += Math.round(matchRatio * 20); // partial
    }
  }

  // Bonus: exact full-query match on title
  if (normalizedTitle === normalizedQuery) {
    score += 20;
  } else if (normalizedTitle.includes(normalizedQuery)) {
    score += 12;
  }

  // Bonus: full query matches an author name
  if (
    normalizedAuthors.some(
      (a) => a === normalizedQuery || a.includes(normalizedQuery),
    )
  ) {
    score += 15;
  }

  // Bonus: query words span BOTH title AND author (cross-field match)
  // This is key: "Bataille Eye" → "Bataille" in author + "Eye" in title
  if (titleWordHits > 0 && authorWordHits > 0) {
    score += 20;
  }

  // 5. If classified as author with high confidence, boost author matches
  if (query.authorScore >= 0.8) {
    const authorMatch = normalizedAuthors.some(
      (a) => a.includes(normalizedQuery) || normalizedQuery.includes(a),
    );
    if (authorMatch) score += 10;
  }

  return score;
}

function rankResults(
  results: SearchResult[],
  query: ClassifiedQuery,
): SearchResult[] {
  const scored = results.map((r) => ({
    ...r,
    _score: scoreResult(r, query),
  }));
  scored.sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
  return scored;
}

// ── Search strategies ──────────────────────────────────────────────────────────

async function safeSearch(
  fn: () => Promise<SearchResult[] | SearchResult | null>,
): Promise<SearchResult[]> {
  try {
    const result = await fn();
    if (!result) return [];
    return Array.isArray(result) ? result : [result];
  } catch {
    return [];
  }
}

async function searchByIsbn(isbn: string): Promise<SearchResult[]> {
  const results = await Promise.all([
    safeSearch(() => searchGoogleBooksByIsbn(isbn)),
    safeSearch(() => searchOpenLibraryByIsbn(isbn)),
  ]);
  return results.flat();
}

/**
 * Comprehensive search strategy for non-ISBN queries.
 *
 * Always runs free-text search on both APIs, plus smart author/title
 * operator splits for multi-word queries. Classification is used as a
 * ranking hint to boost relevant results, not to restrict search scope.
 */
async function searchComprehensive(
  query: ClassifiedQuery,
): Promise<SearchResult[]> {
  const q = query.normalized;
  const words = q.split(/\s+/);

  const searches: Promise<SearchResult[]>[] = [
    // Core: free-text search on both APIs (always)
    safeSearch(() => searchGoogleBooks(q, 10)),
    safeSearch(() => searchOpenLibrary(q, 10)),
  ];

  // Multi-word queries: try author/title operator splits
  if (words.length >= 2 && words.length <= 6) {
    const maxSplits = Math.min(words.length - 1, 3);
    for (let i = 1; i <= maxSplits; i++) {
      const left = words.slice(0, i).join(" ");
      const right = words.slice(i).join(" ");

      // Google Books: left=author, right=title
      searches.push(
        safeSearch(() =>
          searchGoogleBooks(`inauthor:${left} intitle:${right}`, 3),
        ),
      );
      // Google Books: right=author, left=title (reversed)
      searches.push(
        safeSearch(() =>
          searchGoogleBooks(`inauthor:${right} intitle:${left}`, 3),
        ),
      );
      // Open Library: split search with author/title params
      searches.push(
        safeSearch(() => searchOpenLibrarySplit(left, right, 3)),
      );
      searches.push(
        safeSearch(() => searchOpenLibrarySplit(right, left, 3)),
      );
    }
  }

  // High author confidence: add dedicated author search
  if (query.authorScore >= 0.7) {
    searches.push(
      safeSearch(() => searchGoogleBooksByAuthor(q, 5)),
    );
    searches.push(
      safeSearch(() => searchOpenLibraryByAuthor(q, 5)),
    );
  }

  // Low author confidence (likely title): add targeted title search
  if (query.authorScore <= 0.3) {
    searches.push(
      safeSearch(() => searchGoogleBooks(`intitle:"${q}"`, 5)),
    );
  }

  const results = await Promise.all(searches);
  return results.flat();
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function searchBooks(query: string): Promise<SearchResult[]> {
  const classified = classifyQuery(query);

  let raw: SearchResult[];

  if (classified.type === "isbn") {
    raw = await searchByIsbn(classified.isbnClean!);
  } else {
    raw = await searchComprehensive(classified);
  }

  const deduped = deduplicateResults(raw);
  const ranked = rankResults(deduped, classified);

  return ranked.slice(0, 15);
}
