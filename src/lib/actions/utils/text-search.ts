import { sql, type SQL } from "drizzle-orm";
import { searchTokens } from "@/lib/utils/search-text";

/**
 * Ranked, accent-insensitive, typo-tolerant text search (task 0119), shared by
 * every entity search: authors, publishers, recommenders.
 *
 * `haystack` must be `search_normalize()` text (accents removed, lower-case,
 * punctuation turned into spaces). Query words go through the same function,
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

/** Every token appears somewhere in the haystack (any order). */
function allWordsMatch(haystack: SQL, tokens: string[]): SQL {
  return sql.join(
    tokens.map(
      (t) => sql`${haystack} like '%' || search_normalize(${t}) || '%'`,
    ),
    sql` and `,
  );
}

/** Every token starts a word of the haystack (any order). */
function allWordStartsMatch(haystack: SQL, tokens: string[]): SQL {
  return sql.join(
    tokens.map(
      (t) =>
        sql`(' ' || ${haystack}) like '% ' || search_normalize(${t}) || '%'`,
    ),
    sql` and `,
  );
}

/**
 * WHERE condition: every word of the query must appear in the haystack. With
 * `fuzzy`, a word of 4+ letters may also be a close typo, and a multi-word
 * query may match as a whole when it is very close. Undefined for a blank query.
 */
export function textSearchCondition(
  haystack: SQL,
  query: string,
  { fuzzy = true }: { fuzzy?: boolean } = {},
): SQL | undefined {
  const { tokens, text } = queryParts(query);
  if (tokens.length === 0) return undefined;
  if (!fuzzy) return sql`(${allWordsMatch(haystack, tokens)})`;

  const eachWord = sql.join(
    tokens.map((t) =>
      t.length < FUZZY_MIN_LENGTH
        ? sql`${haystack} like '%' || search_normalize(${t}) || '%'`
        : sql`(${haystack} like '%' || search_normalize(${t}) || '%' or strict_word_similarity(search_normalize(${t}), ${haystack}) >= ${WORD_FUZZY_THRESHOLD})`,
    ),
    sql` and `,
  );
  if (tokens.length < 2) return sql`(${eachWord})`;
  return sql`((${eachWord}) or strict_word_similarity(search_normalize(${text}), ${haystack}) >= ${QUERY_FUZZY_THRESHOLD})`;
}

/**
 * Relevance score (higher is better): exact name > name starts with the query
 * > a word starts with the query > every word starts a word > every word
 * appears, plus trigram similarity to break ties and to rank typo matches.
 * `name` is the raw display name; `haystack` the normalized search text.
 */
export function textSearchRank(haystack: SQL, name: SQL, query: string): SQL {
  const { tokens, text } = queryParts(query);
  if (tokens.length === 0) return sql`0`;
  const q = sql`search_normalize(${text})`;
  const nameNorm = sql`search_normalize(${name})`;
  return sql`(case
    when ${nameNorm} = ${q} then 1000
    when ${nameNorm} like ${q} || '%' then 800
    when (' ' || ${haystack}) like '% ' || ${q} || '%' then 600
    when ${allWordStartsMatch(haystack, tokens)} then 400
    when ${allWordsMatch(haystack, tokens)} then 200
    else 0 end
    + 100 * strict_word_similarity(${q}, ${haystack})
    + 50 * similarity(${q}, ${nameNorm}))`;
}
