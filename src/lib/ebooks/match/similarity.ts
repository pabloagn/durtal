/*
 * A dry run scores every library book against every Durtal book, so the same
 * few thousand titles and names are split into trigrams millions of times.
 * Each string's trigrams are kept; the sets are shared, so they are read-only.
 */
const TRIGRAM_CACHE_SIZE = 50_000;
const trigramCache = new Map<string, ReadonlySet<string>[]>();

/** Word padding used by pg_trgm: two spaces before each word and one after it. */
export function wordTrigrams(value: string): ReadonlySet<string>[] {
  const known = trigramCache.get(value);
  if (known) return known;
  const words = (value.match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => {
    const chars = [...`  ${word} `];
    return new Set(
      Array.from({ length: chars.length - 2 }, (_, i) =>
        chars.slice(i, i + 3).join(""),
      ),
    );
  });
  if (trigramCache.size >= TRIGRAM_CACHE_SIZE) trigramCache.clear();
  trigramCache.set(value, words);
  return words;
}
export function trigramSimilarity(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  let common = 0;
  for (const trigram of left) if (right.has(trigram)) common++;
  const union = left.size + right.size - common;
  return union ? common / union : 0;
}
const extentCache = new Map<string, ReadonlySet<string>[]>();
const queryCache = new Map<string, ReadonlySet<string>>();

/** A query's trigrams, all its words together */
function queryTrigrams(query: string): ReadonlySet<string> {
  const known = queryCache.get(query);
  if (known) return known;
  const all = new Set(wordTrigrams(query).flatMap((word) => [...word]));
  if (queryCache.size >= TRIGRAM_CACHE_SIZE) queryCache.clear();
  queryCache.set(query, all);
  return all;
}

/** Every run of whole words in a text, as one trigram set each */
function textExtents(text: string): ReadonlySet<string>[] {
  const known = extentCache.get(text);
  if (known) return known;
  const words = wordTrigrams(text);
  const extents: ReadonlySet<string>[] = [];
  for (let start = 0; start < words.length; start++) {
    const extent = new Set<string>();
    for (let end = start; end < words.length; end++) {
      for (const trigram of words[end]) extent.add(trigram);
      extents.push(new Set(extent));
    }
  }
  if (extentCache.size >= TRIGRAM_CACHE_SIZE) extentCache.clear();
  extentCache.set(text, extents);
  return extents;
}

/** Strict extents start and end at whole words; repeated trigrams count once per extent. */
export function strictWordSimilarity(query: string, text: string): number {
  const left = queryTrigrams(query);
  let best = 0;
  for (const extent of textExtents(text)) {
    best = Math.max(best, trigramSimilarity(left, extent));
    if (best === 1) return best;
  }
  return best;
}
