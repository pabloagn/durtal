/**
 * Text normalization for search. Pure module, usable on server and client.
 *
 * Close to the SQL function `search_normalize()` (migration 0021): remove
 * accents, lower-case, and turn punctuation and whitespace into single
 * spaces. "Péter Nádas" -> "peter nadas", "Gell-Mann" -> "gell mann". A NUL
 * character, which Postgres refuses in text, is dropped (SLN-1137).
 * Not the same outside Latin: it strips every combining mark, so compare its
 * output only with its own (e-books store it as their search text). A query
 * for SQL goes through `searchWords` and `search_normalize()` instead.
 */
import { transliterate } from "@/lib/utils/slugify";
import { cleanText } from "@/lib/utils/clean-text";

/**
 * Normalize text for accent- and case-insensitive comparison. Compatibility
 * forms fold first, so "ﬁ" reads "fi" and fullwidth "Ｈｕｘｌｅｙ" reads
 * "Huxley"; invisible format characters (a soft hyphen, a zero-width space)
 * are dropped, not turned into a space (SLN-1393).
 */
export function normalizeSearchText(text: string): string {
  return transliterate(text.replaceAll("\0", "").normalize("NFKC"))
    .normalize("NFD")
    .replace(/[\p{M}\p{Cf}]/gu, "") // strip combining marks (accents) and format characters
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, " ") // punctuation, symbols, spaces -> one space
    .trim();
}

/**
 * The words of a query that the database folds, as typed: split on spaces,
 * punctuation and symbols, with no folding here. `search_normalize()` folds
 * each word the way it folds the stored text, so the two always meet
 * (SLN-1234). Folding first in the browser broke words apart: Hangul into
 * jamo, "で" into "て", "й" into "и". A piece with no letter or digit (an
 * emoji) is not a word. Holds no "%" or "_", so each is a plain substring,
 * and no NUL, which Postgres refuses (SLN-1137). Invisible characters go as
 * they do from stored text, and compatibility forms fold, so a pasted
 * "Se\u00adbald" or a fullwidth "Ｈｕｘｌｅｙ" still finds its record (SLN-1393).
 */
export function searchWords(query: string): string[] {
  return cleanText(query.replaceAll("\0", ""))
    .normalize("NFKC")
    .split(/[\s\p{P}\p{S}]+/u)
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
}

/** Han, kana and Hangul: one character is often a whole word ("猫") */
const ONE_CHARACTER_WORD = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * Whether a query is worth a search as you type: two characters, or one
 * Chinese, Japanese or Korean character, with a letter or digit among them.
 * A query of symbols alone (an emoji) searches nothing rather than everything.
 */
export function isSearchableQuery(query: string): boolean {
  const words = searchWords(query);
  if (words.length === 0) return false;
  return query.trim().length >= 2 || ONE_CHARACTER_WORD.test(query);
}

/**
 * The words of a search query, normalized, for matching done in JavaScript
 * on both sides. Never for SQL against `search_normalize()`: use
 * `searchWords`. Empty for a blank query.
 */
export function searchTokens(query: string): string[] {
  const normalized = normalizeSearchText(query);
  return normalized ? normalized.split(" ") : [];
}

/**
 * How well `text` matches the query, ignoring accents, case, punctuation and
 * word order. -1: no match (a query word is missing). Otherwise higher is
 * better: 4 exact, 3 starts with the query, 2 a word starts with the query,
 * 1 every query word starts a word, 0 every query word appears somewhere.
 * A blank query scores 0 (matches everything); one of symbols or punctuation
 * alone (an emoji) matches nothing.
 */
export function searchScore(query: string, text: string): number {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return query.trim() ? -1 : 0;
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
