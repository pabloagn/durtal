/** Word padding used by pg_trgm: two spaces before each word and one after it. */
export function wordTrigrams(value: string): Set<string>[] {
  return (value.match(/[\p{L}\p{N}]+/gu) ?? []).map((word) => {
    const chars = [...`  ${word} `];
    return new Set(
      Array.from({ length: chars.length - 2 }, (_, i) =>
        chars.slice(i, i + 3).join(""),
      ),
    );
  });
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
/** Strict extents start and end at whole words; repeated trigrams count once per extent. */
export function strictWordSimilarity(query: string, text: string): number {
  const left = new Set(wordTrigrams(query).flatMap((word) => [...word]));
  const words = wordTrigrams(text);
  let best = 0;
  for (let start = 0; start < words.length; start++) {
    const extent = new Set<string>();
    for (let end = start; end < words.length; end++) {
      for (const trigram of words[end]) extent.add(trigram);
      best = Math.max(best, trigramSimilarity(left, extent));
      if (best === 1) return best;
    }
  }
  return best;
}
