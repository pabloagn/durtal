/*
 * One way to write a place in a book (SLN-680): the contents, the scrubber,
 * the bar, the margins, bookmarks and Places all name a page, a location and
 * a percent with these functions, so one place never reads two ways.
 */

/**
 * A percent as the reader shows it: whole numbers, one decimal below 10%
 * ("7.7%", "56%"). Rounded down, so a book is never shown finished early.
 */
export function formatPercent(percent: number): string {
  const value = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  // A float like 56.99999999 is 57: rounding to 6 places first keeps floor honest.
  const clean = Math.round(value * 1e6) / 1e6;
  if (clean < 10) {
    const tenth = Math.floor(clean * 10) / 10;
    return (Number.isInteger(tenth) ? String(tenth) : tenth.toFixed(1)) + "%";
  }
  return Math.floor(clean) + "%";
}

/** The same, for a 0 to 1 fraction */
export const fractionPercent = (fraction: number) => formatPercent(fraction * 100);

/**
 * A page by its label: "p. 7 of 32" when both are numbers, "p. iv" otherwise;
 * a fixed-layout book (a comic, a PDF) has pages of its own: "Page 3 of 6".
 */
export function pageWords(label: string, last: string | undefined, fixed = false): string {
  const of = last && /^\d+$/.test(last) && /^\d+$/.test(label) ? " of " + last : "";
  return (fixed && /^\d+$/.test(label) ? "Page " : "p. ") + label + of;
}

/**
 * The pages a screen shows, first to last: "pp. 8–9 of 32", "pp. iv–v",
 * "Pages 1–2 of 6"; one page reads as `pageWords`.
 */
export function pageRangeWords(first: string, last: string, total: string | undefined, fixed = false): string {
  if (first === last) return pageWords(first, total, fixed);
  const numeric = /^\d+$/.test(first) && /^\d+$/.test(last);
  const of = numeric && total && /^\d+$/.test(total) ? " of " + total : "";
  return (fixed && numeric ? "Pages " : "pp. ") + first + "–" + last + of;
}

/** "Location 6 of 16" */
export const locationWords = (location: number, count: number) =>
  "Location " + location.toLocaleString() + " of " + count.toLocaleString();

/**
 * Whether a heading only repeats the place beside it: a comic's "Page 3"
 * beside "Page 3 of 6". "Page 1" beside "Page 10 of 12" is not a repeat.
 */
export const samePlace = (heading: string, place: string) =>
  place === heading ||
  place.startsWith(heading + " ") ||
  // "Page 1" beside "Pages 1–2 of 6"
  (/^Page \S+$/.test(heading) && place.startsWith(heading.replace(/^Page /, "Pages ") + "–"));
