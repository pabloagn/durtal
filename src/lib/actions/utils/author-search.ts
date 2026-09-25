import { sql, type SQL } from "drizzle-orm";
import { authors } from "@/lib/db/schema";
import { searchTokens } from "@/lib/utils/search-text";

/**
 * Shared author search (task 0119), used by every author search site.
 *
 * `authors.search_text` holds `search_normalize()` of every name form (name,
 * real name, sort name, first and last name): accents removed, lower-case,
 * punctuation turned into spaces. Query words go through the same function,
 * so "Peter Nadas", "nadas peter" and "Nádas, Péter" all find "Péter Nádas".
 * Normalized words hold only letters and digits, so they are safe inside LIKE.
 */

/** Query words shorter than this only match exactly, never as typos */
const FUZZY_MIN_LENGTH = 4;
/** strict_word_similarity() for one query word to count as a typo ("Krasnahorkai") */
const WORD_FUZZY_THRESHOLD = 0.4;
/**
 * strict_word_similarity() for a multi-word query as a whole ("gabriel garcia
 * markes"). High enough that one shared first name ("Peter ...") is not a match.
 */
const QUERY_FUZZY_THRESHOLD = 0.6;

function queryParts(query: string) {
  const tokens = searchTokens(query);
  return { tokens, text: tokens.join(" ") };
}

/** Every token appears somewhere in the names (any order). */
function allWordsMatch(tokens: string[]): SQL {
  return sql.join(
    tokens.map((t) => sql`${authors.searchText} like '%' || search_normalize(${t}) || '%'`),
    sql` and `,
  );
}

/** Every token starts a word of the names (any order). */
function allWordStartsMatch(tokens: string[]): SQL {
  return sql.join(
    tokens.map((t) => sql`(' ' || ${authors.searchText}) like '% ' || search_normalize(${t}) || '%'`),
    sql` and `,
  );
}

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
  { fuzzy = true }: { fuzzy?: boolean } = {},
): SQL | undefined {
  const { tokens, text } = queryParts(query);
  if (tokens.length === 0) return undefined;
  if (!fuzzy) return sql`(${allWordsMatch(tokens)})`;

  const eachWord = sql.join(
    tokens.map((t) =>
      t.length < FUZZY_MIN_LENGTH
        ? sql`${authors.searchText} like '%' || search_normalize(${t}) || '%'`
        : sql`(${authors.searchText} like '%' || search_normalize(${t}) || '%' or strict_word_similarity(search_normalize(${t}), ${authors.searchText}) >= ${WORD_FUZZY_THRESHOLD})`,
    ),
    sql` and `,
  );
  if (tokens.length < 2) return sql`(${eachWord})`;
  return sql`((${eachWord}) or strict_word_similarity(search_normalize(${text}), ${authors.searchText}) >= ${QUERY_FUZZY_THRESHOLD})`;
}

/**
 * Relevance score for ordering search results (higher is better):
 * exact name > name starts with the query > a word starts with the query >
 * every word starts a word > every word appears, plus trigram similarity to
 * break ties and to rank typo matches.
 */
export function authorSearchRank(query: string): SQL {
  const { tokens, text } = queryParts(query);
  if (tokens.length === 0) return sql`0`;
  const q = sql`search_normalize(${text})`;
  const nameNorm = sql`search_normalize(${authors.name})`;
  return sql`(case
    when ${nameNorm} = ${q} then 1000
    when ${nameNorm} like ${q} || '%' then 800
    when (' ' || ${authors.searchText}) like '% ' || ${q} || '%' then 600
    when ${allWordStartsMatch(tokens)} then 400
    when ${allWordsMatch(tokens)} then 200
    else 0 end
    + 100 * strict_word_similarity(${q}, ${authors.searchText})
    + 50 * similarity(${q}, ${nameNorm}))`;
}

/** Condition: the author's name equals `name`, ignoring accents, case and punctuation. */
export function authorNameEquals(name: string): SQL {
  return sql`search_normalize(${authors.name}) = search_normalize(${name})`;
}
