export interface SearchOptions {
  wholeWords: boolean;
  matchCase: boolean;
  matchAccents: boolean;
}

export const DEFAULT_SEARCH_OPTIONS: Readonly<SearchOptions> = Object.freeze({
  wholeWords: false,
  matchCase: false,
  matchAccents: false,
});
export const SEARCH_HIT_LIMIT = 5_000;

export interface Folded {
  text: string;
  /** Original UTF-16 boundaries for every folded UTF-16 code unit. */
  from: Uint32Array;
  to: Uint32Array;
}

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
};

/** A deterministic fallback, independent of the device's locale. */
export function safeLocale(language?: string | null): string {
  try {
    return Intl.getCanonicalLocales(language || "en")[0] || "en";
  } catch {
    return "en";
  }
}

/** Preserve whole graphemes through decomposition, expansion and case folding. */
export function* foldSearchSteps(
  text: string,
  options: Pick<SearchOptions, "matchCase" | "matchAccents">,
  language?: string | null,
): Generator<void, Folded> {
  const locale = safeLocale(language);
  const segmenter = new Intl.Segmenter(locale, { granularity: "grapheme" });
  const parts: string[] = [];
  let buffer = "";
  let from = new Uint32Array(text.length + 1);
  let to = new Uint32Array(text.length + 1);
  let length = 0;
  let previousSpace = false;
  let steps = 0;
  for (const { segment, index } of segmenter.segment(text)) {
    if (++steps === 2048) {
      steps = 0;
      yield;
    }
    const end = index + segment.length;
    // Resolve compatibility capitals (including non-BMP mathematical letters)
    // before casing. Keep dotted I composed for Turkish locale casing, then
    // decompose for accent matching; all output still owns the original span.
    let folded = segment.normalize("NFKC");
    if (!options.matchCase) folded = folded.toLocaleLowerCase(locale);
    folded = folded.normalize("NFKD").replace(/\p{Cf}/gu, "");
    if (!options.matchAccents) {
      folded = folded
        .replace(/\p{M}/gu, "")
        .replace(/[ßẞæÆœŒøØłŁđĐı]/gu, (ch) => SPECIAL[ch]);
    }
    if (!options.matchCase) folded = folded.replace(/ς/g, "σ");
    if (!folded) {
      if (length) to[length - 1] = end;
      continue;
    }
    const space = /^\s+$/u.test(folded);
    if (space && previousSpace) {
      to[length - 1] = end;
      continue;
    }
    if (space) folded = " ";
    if (length + folded.length > from.length) {
      const capacity = Math.max(from.length * 2, length + folded.length);
      const nextFrom = new Uint32Array(capacity);
      const nextTo = new Uint32Array(capacity);
      nextFrom.set(from);
      nextTo.set(to);
      from = nextFrom;
      to = nextTo;
    }
    for (let i = 0; i < folded.length; i++) {
      from[length] = index;
      to[length++] = end;
    }
    buffer += folded;
    if (buffer.length >= 4_096) {
      parts.push(buffer);
      buffer = "";
    }
    previousSpace = space;
  }
  parts.push(buffer);
  return {
    text: parts.join(""),
    from: from.slice(0, length),
    to: to.slice(0, length),
  };
}

/** Synchronous policy API; workers consume the same steps across task boundaries. */
export function foldForSearch(
  text: string,
  options: Pick<SearchOptions, "matchCase" | "matchAccents">,
  language?: string | null,
): Folded {
  const steps = foldSearchSteps(text, options, language);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

export function minQueryLength(language?: string | null): number {
  return /^(zh|ja|ko)(?:-|$)/i.test(safeLocale(language)) ? 1 : 2;
}
export function queryRuns(query: string, language?: string | null): boolean {
  const clean = query.replace(/\p{Cf}/gu, "").trim();
  return (
    Array.from(clean).length >= minQueryLength(language) &&
    /[^\p{M}\s]/u.test(clean)
  );
}

/** Check word-like segments, not punctuation boundaries or clipped fake words. */
export function onWordBoundaries(
  text: string,
  start: number,
  end: number,
  language?: string | null,
): boolean {
  if (start < 0 || end <= start || end > text.length) return false;
  const from = Math.max(0, start - 64);
  const until = Math.min(text.length, end + 64);
  const segments = new Intl.Segmenter(safeLocale(language), {
    granularity: "word",
  }).segment(text.slice(from, until));
  let begins = false;
  let ends = false;
  for (const part of segments) {
    if (!part.isWordLike) continue;
    if (part.index + from === start) begins = true;
    if (part.index + from + part.segment.length === end) ends = true;
  }
  return begins && ends;
}

export interface TextMatch {
  start: number;
  end: number;
}

/** Lazy results let a caller stop without allocating every match in a section. */
export function* findInText(
  text: string,
  query: string,
  options: SearchOptions,
  language?: string | null,
  folded: Folded = foldForSearch(text, options, language),
  limit = SEARCH_HIT_LIMIT,
): Generator<TextMatch> {
  if (!Number.isInteger(limit) || limit < 0 || limit > SEARCH_HIT_LIMIT)
    throw new RangeError("Invalid search hit limit");
  const needle = foldForSearch(query, options, language).text.trim();
  if (!needle || !limit) return;
  let count = 0;
  for (
    let at = folded.text.indexOf(needle);
    at >= 0;
    at = folded.text.indexOf(needle, at + 1)
  ) {
    const endAt = at + needle.length - 1;
    const start = folded.from[at];
    const end = folded.to[endAt];
    // An s cannot select half of ß, nor e half of an accented grapheme.
    if (at > 0 && folded.from[at - 1] === start) continue;
    if (
      endAt + 1 < folded.text.length &&
      folded.from[endAt + 1] === folded.from[endAt]
    )
      continue;
    if (options.wholeWords && !onWordBoundaries(text, start, end, language))
      continue;
    yield { start, end };
    if (++count === limit) return;
  }
}
