import { describe, expect, it } from "vitest";
import { QUEUE_GAP } from "@/lib/reading/constants";
import { ordinal, positionBetween, queueSummary, readHistory, renumbered, timeToRead, timeToReadText } from "@/lib/reading/queue";
import type { PacePriors } from "@/lib/reading/pace";

/* Up Next's arithmetic (SLN-452): positions and the time a list takes. */

const none: PacePriors = { byLanguageFormat: {}, byFormat: {}, overall: null };
const mine: PacePriors = { byLanguageFormat: { "fr|print": 25 }, byFormat: { print: 40, ebook: 50 }, overall: 45 };

describe("positions", () => {
  it("takes the middle between neighbours, a gap above the top and below the bottom", () => {
    expect(positionBetween(1024, 2048)).toBe(1536);
    expect(positionBetween(null, 1024)).toBe(0);
    expect(positionBetween(3072, null)).toBe(3072 + QUEUE_GAP);
    expect(positionBetween(null, null)).toBe(QUEUE_GAP);
  });

  it("says when no gap is left, and renumbers in steps of 1024", () => {
    expect(positionBetween(10, 11)).toBeNull();
    expect(positionBetween(10, 12)).toBe(11);
    expect(renumbered(["a", "b", "c"]).map((r) => [r.item, r.position])).toEqual([
      ["a", 1024],
      ["b", 2048],
      ["c", 3072],
    ]);
  });
});

describe("time to read", () => {
  it("reads pages at his prior for the language and format, else the format, else everything", () => {
    expect(timeToRead({ pageCount: 250, audioMinutes: null, language: "fr" }, "print", mine)).toEqual({ kind: "pages", pages: 250, minutes: 600, atDefault: false });
    expect(timeToRead({ pageCount: 200, audioMinutes: null, language: "de" }, "print", mine)).toMatchObject({ minutes: 300 });
    expect(timeToRead({ pageCount: 100, audioMinutes: null, language: "de" }, "ebook", mine)).toMatchObject({ minutes: 120 });
    expect(timeToRead({ pageCount: 300, audioMinutes: null, language: "en" }, "print", none)).toMatchObject({ minutes: 600, atDefault: true });
  });

  it("counts an edition with a known audio length as audio, and nothing without a length", () => {
    expect(timeToRead({ pageCount: 300, audioMinutes: 540, language: "en" }, "audio", mine)).toEqual({ kind: "audio", minutes: 540 });
    expect(timeToRead({ pageCount: null, audioMinutes: null, language: "en" }, "print", mine)).toEqual({ kind: "none" });
    expect(timeToRead(null, "print", mine)).toEqual({ kind: "none" });
    expect(timeToReadText({ kind: "audio", minutes: 540 })).toBe("9 h audio");
    expect(timeToReadText({ kind: "pages", minutes: 500, pages: 250, atDefault: false })).toBe("About 8 h 20 min");
  });

  it("sums the list at his pace, counts items without a length apart, and shows pages only before any timed session", () => {
    const at = (minutes: number) => ({ kind: "pages" as const, minutes, pages: 100, atDefault: false });
    expect(queueSummary([at(3000), at(2760), { kind: "none" }, { kind: "none" }])).toBe("4 books · about 96 hours at your pace · 2 without a length");
    expect(queueSummary([at(50)])).toBe("1 book · about 50 min at your pace");
    expect(
      queueSummary([
        { kind: "pages", minutes: 600, pages: 300, atDefault: true },
        { kind: "pages", minutes: 1000, pages: 3910, atDefault: true },
      ]),
    ).toBe("2 books · 4,210 pages");
    expect(queueSummary([])).toBe("0 books");
    // A long list keeps its thousands separator (PR #107 review)
    expect(queueSummary(Array.from({ length: 1200 }, () => at(300)))).toBe("1,200 books · about 6,000 hours at your pace");
  });
});

describe("words", () => {
  it("says the reading history and the place", () => {
    expect(readHistory(0, null)).toBeNull();
    expect(readHistory(1, "2012-05-01")).toBe("Read in 2012");
    expect(readHistory(2, "2019-01-01")).toBe("Read twice, last in 2019");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });
});
