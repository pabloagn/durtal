import type { InsightGroup, InsightInputs } from "./stats";

/*
 * Insights (SLN-456): up to six sentences from fixed templates, each with
 * the numbers behind it and a link to the evidence. A sentence shows only
 * when it means something: at least MIN_GROUP books in each group, and a
 * difference of at least half a star or 20%. Ratings are the read's.
 */

export const MIN_GROUP = 5;
export const MAX_INSIGHTS = 6;

export interface Insight {
  key: string;
  text: string;
  /** "12 books under 250 pages, 9 longer ones" */
  numbers: string;
  href: string;
}

const r1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

/** Both groups big enough and far enough apart */
export function meaningful(a: InsightGroup, b: InsightGroup): boolean {
  if (a.count < MIN_GROUP || b.count < MIN_GROUP || a.avg === null || b.avg === null) return false;
  const diff = Math.abs(a.avg - b.avg);
  return diff >= 0.5 || diff / Math.min(a.avg, b.avg) >= 0.2;
}

function compare(key: string, a: InsightGroup, b: InsightGroup, words: { a: string; b: string; higherA: string; higherB: string; numbers: string }, href: string): Insight | null {
  if (!meaningful(a, b)) return null;
  const aHigher = a.avg! > b.avg!;
  return {
    key,
    text: `${aHigher ? words.higherA : words.higherB} (${r1(aHigher ? a.avg! : b.avg!)} against ${r1(aHigher ? b.avg! : a.avg!)})`,
    numbers: words.numbers.replace("{a}", String(a.count)).replace("{b}", String(b.count)),
    href,
  };
}

/** The year's insights, in a fixed order, at most six */
export function insights(input: InsightInputs, year: number | null): Insight[] {
  const span = year === null ? "" : `yearMin=${year}&yearMax=${year}`;
  const journal = (extra = "") => `/reading/journal?${[span, extra].filter(Boolean).join("&")}`.replace(/\?$/, "");
  const out = [
    compare(
      "length",
      input.short,
      input.long,
      {
        a: "short",
        b: "long",
        higherA: "Your ratings are highest for books under 250 pages",
        higherB: "Your ratings are highest for books of 250 pages or more",
        numbers: "{a} rated books under 250 pages, {b} longer ones",
      },
      journal("status=finished"),
    ),
    compare(
      "translation",
      input.translated,
      input.original,
      {
        a: "translated",
        b: "original",
        higherA: "You rate translated books higher",
        higherB: "You rate books in their original language higher",
        numbers: "{a} rated in translation, {b} in the original language",
      },
      journal("status=finished"),
    ),
    compare(
      "rereads",
      input.rereads,
      input.firstReads,
      {
        a: "rereads",
        b: "first",
        higherA: "You rate books higher on a re-read",
        higherB: "You rate books higher on a first read",
        numbers: "{a} rated re-reads, {b} rated first reads",
      },
      journal("rereads=1"),
    ),
    compare(
      "copies",
      input.ownCopy,
      input.noCopy,
      {
        a: "own",
        b: "borrowed",
        higherA: "Books from your own shelves get higher ratings",
        higherB: "Borrowed books get higher ratings than your own copies",
        numbers: "{a} rated from your copies, {b} rated with no copy",
      },
      journal("status=finished"),
    ),
    input.started >= MIN_GROUP
      ? {
          key: "finish",
          text: `You finish ${Math.round((input.finished / input.started) * 10)} of 10 books you start`,
          numbers: `${input.finished} finished, ${input.started - input.finished} abandoned`,
          href: journal("status=finished,abandoned"),
        }
      : null,
  ];
  return out.filter((i): i is Insight => i !== null).slice(0, MAX_INSIGHTS);
}
