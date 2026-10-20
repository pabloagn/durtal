import { approxSearch } from "./approx-match";

/**
 * Finding a stored text quote again in a section's text (eBooks sub-issue 3),
 * when the CFI no longer applies: the file was replaced, or re-made by
 * another tool. The highlighted text is searched for allowing a few errors
 * (a corrected typo, changed punctuation), and the text around each candidate
 * is compared with the stored context to pick the right one when the passage
 * occurs more than once.
 */

export interface TextQuote {
  before?: string;
  highlight?: string;
  after?: string;
}

export interface QuoteMatch {
  start: number;
  end: number;
  /** 0 to 1 */
  score: number;
}

/** Whitespace runs read as one space: tools re-wrap text freely */
export function normalizeQuoteText(text: string): string {
  return text.replace(/\s+/g, " ");
}

const graphemes = typeof Intl !== "undefined" && "Segmenter" in Intl
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;
const isHigh = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLow = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/**
 * At most the first `limit` UTF-16 units of `text`, cut between characters
 * as a reader sees them (SLN-1494): an emoji, a flag or a ZWJ family stays
 * whole or goes, and no half of a surrogate pair is left, which the stored
 * locator refuses.
 */
export function headOf(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (graphemes) {
    let end = 0;
    for (const { segment } of graphemes.segment(text)) {
      if (end + segment.length > limit) break;
      end += segment.length;
    }
    return text.slice(0, end);
  }
  return text.slice(0, isHigh(text.charCodeAt(limit - 1)) ? limit - 1 : limit);
}

/** At most the last `limit` UTF-16 units of `text`, cut between characters as `headOf` cuts */
export function tailOf(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const start = text.length - limit;
  if (graphemes) {
    for (const { index } of graphemes.segment(text)) if (index >= start) return text.slice(index);
    return "";
  }
  return text.slice(isLow(text.charCodeAt(start)) ? start + 1 : start);
}

/** Up to one error in five characters of the passage */
const ERROR_RATE = 0.2;
/** Below this, a candidate is not the passage */
const MIN_SCORE = 0.55;

/** How alike two strings are, 0 to 1: one minus the edit distance over the length */
function similarity(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  const errors = Math.min(a.length, b.length);
  const found = approxSearch(a, b, errors);
  if (!found.length) return 0;
  return Math.max(0, 1 - found[0].errors / b.length);
}

/**
 * The best place of `quote` in `text`, or null when it is not there. `hint`
 * (an offset into `text`) breaks ties between equally good candidates.
 */
export function matchQuote(text: string, quote: TextQuote, hint?: number): QuoteMatch | null {
  const highlight = normalizeQuoteText(quote.highlight ?? "").trim();
  const before = normalizeQuoteText(quote.before ?? "");
  const after = normalizeQuoteText(quote.after ?? "");
  if (highlight.length < 4) return null;
  const maxErrors = Math.max(1, Math.floor(highlight.length * ERROR_RATE));
  const candidates = approxSearch(text, highlight, maxErrors);
  let best: QuoteMatch | null = null;
  for (const candidate of candidates) {
    const quoteScore = 1 - candidate.errors / highlight.length;
    const beforeScore = before.trim()
      ? similarity(text.slice(Math.max(0, candidate.start - before.length - 4), candidate.start), before.trim())
      : 1;
    const afterScore = after.trim()
      ? similarity(text.slice(candidate.end, candidate.end + after.length + 4), after.trim())
      : 1;
    const nearness = hint === undefined ? 1 : 1 - Math.min(1, Math.abs(candidate.start - hint) / Math.max(1, text.length));
    const score = (quoteScore * 50 + beforeScore * 20 + afterScore * 20 + nearness * 2) / 92;
    if (quoteScore < 1 - ERROR_RATE || score < MIN_SCORE) continue;
    if (!best || score > best.score) best = { start: candidate.start, end: candidate.end, score };
  }
  return best;
}
