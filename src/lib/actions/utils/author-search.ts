import { sql, type SQL } from "drizzle-orm";
import { authors } from "@/lib/db/schema";
import { textSearchCondition, textSearchRank } from "./text-search";

/**
 * Shared author search (task 0119), used by every author search site. The
 * engine itself lives in `text-search.ts`.
 *
 * `authors.search_text` holds `search_normalize()` of every name form (name,
 * real name, sort name, first and last name): accents removed, lower-case,
 * punctuation turned into spaces. Query words go through the same function,
 * so "Peter Nadas", "nadas peter" and "Nádas, Péter" all find "Péter Nádas".
 * Normalized words hold only letters and digits, so they are safe inside LIKE.
 */

const haystack = sql`${authors.searchText}`;

/**
 * WHERE condition for an author search. Every word of the query must appear
 * in the author's names. With `fuzzy`, a word of 4+ letters may also be a
 * close typo, and a multi-word query may match as a whole when it is very
 * close ("gabriel garcia markes"). Returns undefined for a blank query.
 *
 * Use `fuzzy: false` where authors are only one of several things a query
 * can match (library and collection search), to avoid noise.
 */
export function authorSearchCondition(
  query: string,
  options: { fuzzy?: boolean } = {},
): SQL | undefined {
  return textSearchCondition(haystack, query, options);
}

/** Relevance score for ordering author search results (higher is better). */
export function authorSearchRank(query: string): SQL {
  return textSearchRank(haystack, sql`${authors.name}`, query);
}

/** Condition: the author's name equals `name`, ignoring accents, case and punctuation. */
export function authorNameEquals(name: string): SQL {
  return sql`search_normalize(${authors.name}) = search_normalize(${name})`;
}
