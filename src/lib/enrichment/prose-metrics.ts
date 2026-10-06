/**
 * Prose metrics of a text (SLN-466): sentence length, rare-word share and
 * MATTR. They are raw numbers and never become a label here. Sentences and
 * words come from Node's Intl.Segmenter, so the ICU version decides the
 * segments. The text stays in memory: only the numbers are returned.
 */

/** The moving window of MATTR, in word tokens */
export const MATTR_WINDOW = 500;

export interface FrequencyList {
  key: string;
  version: string;
  /** Case-folded forms, the most frequent first */
  forms: readonly string[];
}

export interface ProseOptions {
  /** The text's language (BCP 47); null when it is unknown */
  language: string | null;
  /** The frequency list of that language and its cut-off N; absent when none is approved */
  list?: FrequencyList;
  cutoff?: number;
  window?: number;
}

export interface ProseMetrics {
  sentenceCount: number;
  meanSentenceWords: number;
  medianSentenceWords: number;
  /** The share of word tokens outside the list's top N forms; null with a reason when it cannot be measured */
  rareWordShare: number | null;
  rareWordSkip: "language_unknown" | "no_list" | null;
  mattr: number;
  mattrWindow: number;
}

/** The words of each sentence. A paragraph break ends a sentence; a sentence with no word is dropped */
export function sentenceWords(text: string, language: string | null): string[][] {
  const locale = language ?? undefined;
  const sentences = new Intl.Segmenter(locale, { granularity: "sentence" });
  const words = new Intl.Segmenter(locale, { granularity: "word" });
  return text
    .normalize("NFC")
    .split(/\n\s*\n/)
    .flatMap((paragraph) => [...sentences.segment(paragraph)])
    .map((sentence) => [...words.segment(sentence.segment)].filter((w) => w.isWordLike).map((w) => w.segment))
    .filter((sentence) => sentence.length > 0);
}

/** The mean type-token ratio of every window of `window` tokens; the whole text's ratio when it is shorter */
export function mattr(tokens: readonly string[], window = MATTR_WINDOW): number {
  if (tokens.length <= window) return new Set(tokens).size / tokens.length;
  const counts = new Map<string, number>();
  for (const token of tokens.slice(0, window)) counts.set(token, (counts.get(token) ?? 0) + 1);
  let types = counts.size;
  let total = types;
  // Slide the window one token at a time: one token leaves, one enters
  for (let start = 1; start + window <= tokens.length; start++) {
    const leaving = tokens[start - 1];
    const left = counts.get(leaving)! - 1;
    if (left === 0) {
      counts.delete(leaving);
      types--;
    } else counts.set(leaving, left);
    const entering = tokens[start + window - 1];
    if (!counts.has(entering)) types++;
    counts.set(entering, (counts.get(entering) ?? 0) + 1);
    total += types;
  }
  return total / (window * (tokens.length - window + 1));
}

export function proseMetrics(text: string, { language, list, cutoff, window = MATTR_WINDOW }: ProseOptions): ProseMetrics {
  const sentences = sentenceWords(text, language);
  const lengths = sentences.map((s) => s.length).sort((a, b) => a - b);
  const middle = Math.floor(lengths.length / 2);
  // Word tokens: words made only of letters
  const words = sentences.flat().filter((w) => /^\p{L}+$/u.test(w));
  const tokens = words.map((w) => w.toLocaleLowerCase(language ?? undefined));
  return {
    sentenceCount: sentences.length,
    meanSentenceWords: lengths.reduce((a, b) => a + b, 0) / lengths.length,
    medianSentenceWords: lengths.length % 2 ? lengths[middle] : (lengths[middle - 1] + lengths[middle]) / 2,
    ...rareWords(words, tokens, language, list, cutoff),
    mattr: mattr(tokens, window),
    mattrWindow: window,
  };
}

/**
 * The share of tokens outside the list's top N forms. A form that never
 * appears in lower case in the text is a name and is left out, except in
 * German, which capitalises nouns.
 */
function rareWords(
  words: string[],
  tokens: string[],
  language: string | null,
  list: FrequencyList | undefined,
  cutoff: number | undefined,
): Pick<ProseMetrics, "rareWordShare" | "rareWordSkip"> {
  if (!language) return { rareWordShare: null, rareWordSkip: "language_unknown" };
  if (!list || !cutoff) return { rareWordShare: null, rareWordSkip: "no_list" };
  const common = new Set(list.forms.slice(0, cutoff));
  const lowerCase = new Set(words.filter((w, i) => w === tokens[i]));
  const counted = language.split("-")[0] === "de" ? tokens : tokens.filter((t) => lowerCase.has(t));
  const rare = counted.filter((t) => !common.has(t)).length;
  return { rareWordShare: rare / counted.length, rareWordSkip: null };
}
