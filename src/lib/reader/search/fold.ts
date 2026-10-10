/**
 * Folding text for search in the book (eBooks sub-issue 14). By default a
 * search ignores accents and case: each section's text and the query are
 * folded the same way, and the folded query is found with indexOf, which is
 * many times faster than the engine's grapheme-by-grapheme Intl.Collator
 * comparison. An offset map leads every folded character back to the
 * original text, so a match becomes a Range over the book's own nodes.
 *
 * Folding: NFKD; combining marks dropped unless Match accents is on; lower
 * case in the book's language unless Match case is on; ß→ss, æ→ae, œ→oe,
 * ø→o, ł→l, đ→d, ı→i (and final ς→σ) unless Match accents is on; every run
 * of whitespace is one space and formatting characters (soft hyphens,
 * joiners) are left out, as the engine's own search does.
 */

export interface SearchOptions {
  wholeWords: boolean;
  matchCase: boolean;
  matchAccents: boolean;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = { wholeWords: false, matchCase: false, matchAccents: false };

/** Letters a reader types without their stroke or as two letters */
const SPECIAL: Record<string, string> = {
  ß: "ss",
  ẞ: "SS",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ø: "o",
  Ø: "O",
  ł: "l",
  Ł: "L",
  đ: "d",
  Đ: "D",
  ı: "i",
  ς: "σ",
};

const SPACE = /\s/u;
const FORMAT = /\p{Cf}/u;
const MARKS = /\p{M}/gu;
const SPECIAL_RE = /[ßẞæÆœŒøØłŁđĐıς]/gu;

/** The folded text and, for each folded character, the original characters it came from */
export interface Folded {
  text: string;
  /** Where each folded character's source starts in the original text */
  from: Uint32Array;
  /** Where it ends (exclusive) */
  to: Uint32Array;
}

/** A language tag toLocaleLowerCase accepts, else undefined (the default locale) */
export function safeLocale(lang: string | null | undefined): string | undefined {
  if (!lang) return undefined;
  try {
    "a".toLocaleLowerCase(lang);
    return lang;
  } catch {
    return undefined;
  }
}

/** Languages whose dotted and dotless i lower case differently from the default */
const LOCALE_SENSITIVE_ASCII = /^(tr|az|lt)\b/i;

export function foldForSearch(
  text: string,
  options: Pick<SearchOptions, "matchCase" | "matchAccents">,
  lang?: string | null,
): Folded {
  const locale = safeLocale(lang);
  const asciiLower = !options.matchCase && !(locale && LOCALE_SENSITIVE_ASCII.test(locale));
  const from = new Uint32Array(text.length + 1);
  const to = new Uint32Array(text.length + 1);
  let out = "";
  // Built in chunks: string concatenation of single characters is slow on long texts
  const parts: string[] = [];
  let n = 0;
  let lastSpace = false;
  let fromArr = from;
  let toArr = to;
  const push = (chars: string, start: number, end: number) => {
    // Folding can expand (ß→ss, ﬃ→ffi): the arrays grow when it does
    if (n + chars.length >= fromArr.length) {
      const size = Math.max(fromArr.length * 2, n + chars.length + 1);
      const f = new Uint32Array(size);
      const t = new Uint32Array(size);
      f.set(fromArr);
      t.set(toArr);
      fromArr = f;
      toArr = t;
    }
    for (let k = 0; k < chars.length; k++) {
      fromArr[n] = start;
      toArr[n] = end;
      n++;
    }
    out += chars;
    if (out.length > 4096) {
      parts.push(out);
      out = "";
    }
  };
  for (let i = 0; i < text.length; ) {
    const code = text.charCodeAt(i);
    if (code < 128) {
      if (code === 32 || (code >= 9 && code <= 13)) {
        if (lastSpace) toArr[n - 1] = i + 1;
        else push(" ", i, i + 1);
        lastSpace = true;
      } else {
        const ch = asciiLower && code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : text[i];
        push(!options.matchCase && !asciiLower ? ch.toLocaleLowerCase(locale) : ch, i, i + 1);
        lastSpace = false;
      }
      i++;
      continue;
    }
    const cp = text.codePointAt(i)!;
    const len = cp > 0xffff ? 2 : 1;
    const ch = len === 2 ? text.slice(i, i + 2) : text[i];
    if (SPACE.test(ch)) {
      if (lastSpace) toArr[n - 1] = i + len;
      else push(" ", i, i + len);
      lastSpace = true;
      i += len;
      continue;
    }
    if (FORMAT.test(ch)) {
      // A soft hyphen or a joiner inside a word: the word reads as if it were not there
      if (n > 0) toArr[n - 1] = i + len;
      i += len;
      continue;
    }
    let folded = ch.normalize("NFKD");
    if (!options.matchAccents) folded = folded.replace(MARKS, "");
    if (!options.matchCase) folded = folded.toLocaleLowerCase(locale);
    if (!options.matchAccents) folded = folded.replace(SPECIAL_RE, (c) => SPECIAL[c] ?? c);
    if (folded) {
      push(folded, i, i + len);
      lastSpace = false;
    } else if (n > 0) {
      // A lone combining mark: it belongs to the letter before it
      toArr[n - 1] = i + len;
    }
    i += len;
  }
  parts.push(out);
  return { text: parts.join(""), from: fromArr.subarray(0, n), to: toArr.subarray(0, n) };
}

/** The query as it is matched: folded like the text, its outer spaces trimmed */
export function foldQuery(query: string, options: SearchOptions, lang?: string | null): string {
  return foldForSearch(query, options, lang).text.trim();
}

/** Languages written without spaces between words: one character is a query */
const CJK = /^(zh|ja|ko)\b/i;

/** The shortest query that runs: 2 characters, 1 in Chinese, Japanese and Korean */
export function minQueryLength(lang: string | null | undefined): number {
  return lang && CJK.test(lang) ? 1 : 2;
}

/** Whether a query is long enough to run, in the book's language */
export function queryRuns(query: string, lang: string | null | undefined): boolean {
  return Array.from(query.trim()).length >= minQueryLength(lang);
}

/**
 * Word boundaries around [start, end) of the text, by Intl.Segmenter over 64
 * characters either side: a whole-word match starts and ends on one.
 */
export function onWordBoundaries(text: string, start: number, end: number, lang?: string | null): boolean {
  const from = Math.max(0, start - 64);
  const until = Math.min(text.length, end + 64);
  const slice = text.slice(from, until);
  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(safeLocale(lang), { granularity: "word" });
  } catch {
    segmenter = new Intl.Segmenter("en", { granularity: "word" });
  }
  const boundaries = new Set<number>([until - from]);
  for (const segment of segmenter.segment(slice)) boundaries.add(segment.index);
  return boundaries.has(start - from) && boundaries.has(end - from);
}

/**
 * Every match of the folded query in the text, as original offsets
 * [start, end). Matches may overlap, as in the engine's own search.
 */
export function findInText(
  text: string,
  query: string,
  options: SearchOptions,
  lang?: string | null,
  folded: Folded = foldForSearch(text, options, lang),
): { start: number; end: number }[] {
  const needle = foldQuery(query, options, lang);
  const out: { start: number; end: number }[] = [];
  if (!needle) return out;
  const haystack = folded.text;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    const start = folded.from[at];
    const end = folded.to[at + needle.length - 1];
    // A match must cover the whole of the characters it starts and ends in
    if (at > 0 && folded.from[at - 1] === start) continue;
    if (at + needle.length < haystack.length && folded.to[at + needle.length] === end) continue;
    if (options.wholeWords && !onWordBoundaries(text, start, end, lang)) continue;
    out.push({ start, end });
  }
  return out;
}
