/**
 * Text normalization for search. Pure module, usable on server and client.
 *
 * Mirrors the SQL function `search_normalize()` (migration 0021): remove
 * accents, lower-case, and turn punctuation and whitespace into single
 * spaces. "Péter Nádas" -> "peter nadas", "Gell-Mann" -> "gell mann".
 */
import { transliterate } from "@/lib/utils/slugify";

/** Normalize text for accent- and case-insensitive comparison. */
export function normalizeSearchText(text: string): string {
  return transliterate(text)
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // strip combining marks (accents)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, " ") // punctuation, symbols, spaces -> one space
    .trim();
}

/** The words of a search query, normalized. Empty for a blank query. */
export function searchTokens(query: string): string[] {
  const normalized = normalizeSearchText(query);
  return normalized ? normalized.split(" ") : [];
}

/**
 * How well `text` matches the query, ignoring accents, case, punctuation and
 * word order. -1: no match (a query word is missing). Otherwise higher is
 * better: 4 exact, 3 starts with the query, 2 a word starts with the query,
 * 1 every query word starts a word, 0 every query word appears somewhere.
 * A blank query scores 0 (matches everything).
 */
export function searchScore(query: string, text: string): number {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return 0;
  const haystack = normalizeSearchText(text);
  if (!tokens.every((t) => haystack.includes(t))) return -1;
  const q = tokens.join(" ");
  if (haystack === q) return 4;
  if (haystack.startsWith(q)) return 3;
  const spaced = ` ${haystack}`;
  if (spaced.includes(` ${q}`)) return 2;
  if (tokens.every((t) => spaced.includes(` ${t}`))) return 1;
  return 0;
}

/** Items matching the query, best matches first (ties keep their order). */
export function filterBySearch<T>(items: T[], query: string, text: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, score: searchScore(query, text(item)) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.item);
}
