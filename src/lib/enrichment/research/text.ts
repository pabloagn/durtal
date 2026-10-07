import type { ResearchProfile } from "./profile";
import { RESEARCH_CONFIG } from "./config";

/*
 * Reading a stored document for extraction (SLN-469, section 3). Every
 * length and offset counts Unicode code points of the stored text, never
 * UTF-16 units. The relevance gate compares NFC text after toLowerCase(),
 * because it is not an excerpt check; passages are exact slices of the text.
 */

export interface Passage {
  id: string;
  /** Code point offsets in the stored text */
  start: number;
  end: number;
  text: string;
}

/** The text as code points, with each lowercase code point's place in it */
function lowered(chars: string[]) {
  let lower = "";
  const origin: number[] = [];
  chars.forEach((ch, i) => {
    for (const l of ch.toLowerCase()) {
      lower += l;
      origin.push(i);
    }
  });
  return { lower, origin };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every whole-word match of a phrase, as code point spans of the text */
function wholeWords(chars: string[], phrase: string): { start: number; end: number }[] {
  const needle = phrase.normalize("NFC").toLowerCase().trim();
  if (!needle) return [];
  const { lower, origin } = lowered(chars);
  const lowerChars = [...lower];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(needle)}(?![\\p{L}\\p{N}])`, "gu");
  const spans: { start: number; end: number }[] = [];
  for (const m of lower.matchAll(re)) {
    const at = [...lower.slice(0, m.index)].length;
    const length = [...m[0]].length;
    spans.push({ start: origin[at], end: (origin[at + length - 1] ?? lowerChars.length - 1) + 1 });
  }
  return spans;
}

/**
 * Whether a document is about the book: one of its titles and one author's
 * surname, each as whole words. Returns every match, for the passage windows.
 */
export function aboutWork(text: string, profile: Pick<ResearchProfile, "titles" | "authors">) {
  const chars = [...text.normalize("NFC")];
  const titles = profile.titles.flatMap((t) => wholeWords(chars, t));
  const surnames = profile.authors.flatMap((a) => wholeWords(chars, a.surname));
  return { about: titles.length > 0 && surnames.length > 0, matches: [...titles, ...surnames].sort((a, b) => a.start - b.start) };
}

/**
 * The passages sent for one document: the whole text when it is short
 * enough; else windows around every match, merged when they touch, in text
 * order until the total reaches the limit, the last one cut there.
 */
export function passagesOf(text: string, matches: { start: number; end: number }[], maxChars: number = RESEARCH_CONFIG.maxPassageChars): Passage[] {
  const chars = [...text];
  const slice = (start: number, end: number) => chars.slice(start, end).join("");
  if (chars.length <= maxChars) return [{ id: "p1", start: 0, end: chars.length, text }];
  const windows: { start: number; end: number }[] = [];
  for (const m of [...matches].sort((a, b) => a.start - b.start)) {
    const w = { start: Math.max(0, m.start - RESEARCH_CONFIG.passageWindow), end: Math.min(chars.length, m.end + RESEARCH_CONFIG.passageWindow) };
    const last = windows.at(-1);
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end);
    else windows.push(w);
  }
  const passages: Passage[] = [];
  let total = 0;
  for (const w of windows) {
    if (total >= maxChars) break;
    const end = Math.min(w.end, w.start + (maxChars - total));
    passages.push({ id: `p${passages.length + 1}`, start: w.start, end, text: slice(w.start, end) });
    total += end - w.start;
  }
  return passages;
}
