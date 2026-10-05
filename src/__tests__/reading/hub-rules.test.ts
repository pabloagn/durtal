import { describe, expect, it } from "vitest";
import { journalGroup, parseJournalQuery } from "@/lib/reading/journal-params";
import { addBookParams, bookPickerAddHref, isbnOf, pickerReadingState } from "@/lib/reading/book-picker";
import { paletteReadingItems, queryNamesATitle, type PaletteOpenReading } from "@/lib/reading/palette";
import { READING_TABS, readingTabs } from "@/components/reading/reading-tabs";
import { agoText, lastReadText } from "@/lib/reading/labels";

// The reading hub's pure rules (SLN-448).

describe("parseJournalQuery", () => {
  it("reads every parameter", () => {
    const q = parseJournalQuery({
      q: "  proust ",
      status: "finished,abandoned",
      yearMin: "2012",
      yearMax: "2020",
      format: "print,audio",
      minRating: "3.5",
      rereads: "1",
      sort: "rating",
      order: "asc",
      page: "3",
      perPage: "96",
    });
    expect(q).toEqual({
      q: "proust",
      status: ["finished", "abandoned"],
      yearMin: 2012,
      yearMax: 2020,
      formats: ["print", "audio"],
      minRating: 3.5,
      rereads: true,
      sort: "rating",
      order: "asc",
      page: 3,
      perPage: 96,
      offset: 192,
    });
  });

  it("drops bad values and falls back to the defaults", () => {
    const q = parseJournalQuery({
      status: "finished,lost,finished",
      yearMin: "20x2",
      yearMax: "99999",
      format: "scroll",
      minRating: "3.3",
      rereads: "yes",
      sort: "pages",
      order: "sideways",
      page: "-1",
      perPage: "50",
      q: "   ",
    });
    expect(q).toMatchObject({ q: undefined, status: ["finished"], yearMin: undefined, yearMax: undefined, formats: [], minRating: undefined, rereads: false });
    expect(q).toMatchObject({ sort: "finished", order: "desc", page: 1, perPage: 48, offset: 0 });
  });

  it("gives each sort its default order and swaps a reversed year range", () => {
    expect(parseJournalQuery({ sort: "title" }).order).toBe("asc");
    expect(parseJournalQuery({ sort: "started" }).order).toBe("desc");
    expect(parseJournalQuery({ yearMin: "2020", yearMax: "2012" })).toMatchObject({ yearMin: 2012, yearMax: 2020 });
    expect(parseJournalQuery({ q: "x".repeat(300) }).q).toHaveLength(200);
  });

  it("groups rows: in progress, the year of finish or stop, date unknown", () => {
    expect(journalGroup({ status: "reading", finishedOn: null })).toBe("In progress");
    expect(journalGroup({ status: "paused", finishedOn: null })).toBe("In progress");
    expect(journalGroup({ status: "finished", finishedOn: "2019-04-01" })).toBe("2019");
    expect(journalGroup({ status: "abandoned", finishedOn: "2012-01-01" })).toBe("2012");
    expect(journalGroup({ status: "finished", finishedOn: null })).toBe("Date unknown");
  });
});

describe("bookPickerAddHref", () => {
  it("sends a title as the query", () => {
    expect(bookPickerAddHref("  Le Temps retrouvé ", "start")).toBe("/library/new?q=Le+Temps+retrouv%C3%A9&then=start");
  });

  it("sends an ISBN-13 with hyphens as an ISBN", () => {
    expect(bookPickerAddHref("978-0-14-118776-1", "start")).toBe("/library/new?isbn=9780141187761&then=start");
  });

  it("sends an ISBN-10 ending in X as an ISBN", () => {
    expect(bookPickerAddHref("0-8044-2957-x", "past")).toBe("/library/new?isbn=080442957X&then=past");
  });

  it("says which dialog opens after the book is added", () => {
    expect(bookPickerAddHref("Watt", "past")).toBe("/library/new?q=Watt&then=past");
    expect(isbnOf("12345")).toBeNull();
    expect(isbnOf("97801411877612")).toBeNull();
  });

  it("keeps the add page's parameters only when valid", () => {
    expect(addBookParams({ q: "  Watt ", isbn: "978 0 14 118776 1", then: "start" })).toEqual({ initialQuery: "Watt", initialIsbn: "9780141187761", then: "start" });
    expect(addBookParams({ q: "   ", isbn: "not-an-isbn", then: "later" })).toEqual({ initialQuery: null, initialIsbn: null, then: null });
    expect(addBookParams({ q: ["a", "b"], then: ["past"] })).toEqual({ initialQuery: "a", initialIsbn: null, then: "past" });
    expect(addBookParams({ q: "y".repeat(250) }).initialQuery).toHaveLength(200);
  });
});

describe("paletteReadingItems", () => {
  const open = (id: string, title: string, over: Partial<PaletteOpenReading["reading"]> = {}): PaletteOpenReading => ({
    reading: { id, workId: `w-${id}`, unit: "pages", totalPages: 480, totalMinutes: null, ...over },
    fingerprint: `fp-${id}`,
    work: { id: `w-${id}`, title },
  });
  const watt = open("r1", "Watt");
  const audio = open("r2", "Molloy", { unit: "minutes", totalPages: null, totalMinutes: 580 });

  it("logs a page, a percent and a time", () => {
    expect(paletteReadingItems("212", [watt]).smart).toEqual([
      { value: "reading-smart:r1", label: "Log p. 212 · Watt", request: { kind: "progress", workId: "w-r1", readingId: "r1", fingerprint: "fp-r1", prefill: "212" }, input: { kind: "page", page: 212 } },
    ]);
    expect(paletteReadingItems("44%", [watt]).smart[0]).toMatchObject({ label: "Log 44% · Watt", input: { kind: "percent", percent: 44 } });
    expect(paletteReadingItems("3:12", [audio]).smart[0]).toMatchObject({ label: "Log 3:12 · Molloy", input: { kind: "minutes", minutes: 192 } });
  });

  it("keeps +20 relative: pages, or minutes for an audiobook", () => {
    expect(paletteReadingItems("+20", [watt]).smart[0]).toMatchObject({ label: "Log +20 pages · Watt", input: { kind: "addPages", pages: 20 }, request: { prefill: "+20" } });
    expect(paletteReadingItems("+20", [audio]).smart[0]).toMatchObject({ label: "Log +20 min · Molloy", input: { kind: "addMinutes", minutes: 20 } });
  });

  it("offers nothing smart with no open reading, a search, a chapter or a page past the end", () => {
    expect(paletteReadingItems("212", [])).toEqual({ smart: [], log: [] });
    expect(paletteReadingItems("Chekhov", [watt]).smart).toEqual([]);
    expect(paletteReadingItems("ch 7", [watt]).smart).toEqual([]);
    expect(paletteReadingItems("900", [watt]).smart).toEqual([]);
    expect(paletteReadingItems("", [watt]).smart).toEqual([]);
  });

  it("gives one item per open reading that the position fits, each with its fingerprint", () => {
    const short = open("r3", "Short", { totalPages: 100 });
    const { smart, log } = paletteReadingItems("p. 212", [watt, short, audio]);
    expect(smart.map((i) => i.label)).toEqual(["Log p. 212 · Watt"]);
    expect(log.map((i) => [i.label, i.request.fingerprint])).toEqual([
      ["Log progress · Watt", "fp-r1"],
      ["Log progress · Short", "fp-r3"],
      ["Log progress · Molloy", "fp-r2"],
    ]);
    const both = paletteReadingItems("50%", [watt, audio]).smart;
    expect(both.map((i) => [i.label, i.request.fingerprint, i.request.readingId])).toEqual([
      ["Log 50% · Watt", "fp-r1", "r1"],
      ["Log 50% · Molloy", "fp-r2", "r2"],
    ]);
  });
});

describe("queryNamesATitle", () => {
  it("finds the query as a whole word of a title", () => {
    expect(queryNamesATitle("451", ["Watt", "Fahrenheit 451"])).toBe(true);
    expect(queryNamesATitle(" 84 ", ["84, Charing Cross Road"])).toBe(true);
    expect(queryNamesATitle("22", ["Catch-22"])).toBe(true);
  });

  it("does not take part of a word, or no title, or no query", () => {
    expect(queryNamesATitle("45", ["Fahrenheit 451"])).toBe(false);
    expect(queryNamesATitle("212", ["Watt"])).toBe(false);
    expect(queryNamesATitle("212", [])).toBe(false);
    expect(queryNamesATitle("", ["Fahrenheit 451"])).toBe(false);
  });
});

describe("readingTabs", () => {
  it("holds the final order and shows only the tabs whose pages exist", () => {
    expect(READING_TABS.map((t) => t.label)).toEqual(["Now", "Up next", "Journal", "Notes", "Stats", "Suggestions", "Import"]);
    expect(readingTabs("/reading").map((t) => t.label)).toEqual(["Now", "Up next", "Journal", "Notes", "Stats", "Suggestions", "Import"]);
  });

  it("lights Now on /reading only, and Journal on its path and below", () => {
    expect(readingTabs("/reading").map((t) => t.current)).toEqual([true, false, false, false, false, false, false]);
    expect(readingTabs("/reading/next").map((t) => t.current)).toEqual([false, true, false, false, false, false, false]);
    // The search string is not part of the path: /reading/journal?year=2024
    expect(readingTabs("/reading/journal").map((t) => t.current)).toEqual([false, false, true, false, false, false, false]);
    expect(readingTabs("/reading/journal/2024").map((t) => t.current)).toEqual([false, false, true, false, false, false, false]);
    expect(readingTabs("/reading/journalism").map((t) => t.current)).toEqual([false, false, false, false, false, false, false]);
    expect(readingTabs("/reading/notes").map((t) => t.current)).toEqual([false, false, false, true, false, false, false]);
    expect(readingTabs("/reading/import/0b5f2f48-3d43-4c1e-9e43-3c1f6d1b2a10").map((t) => t.current)).toEqual([false, false, false, false, false, false, true]);
  });

  it("lights Suggestions on its page and its Hidden view (SLN-457)", () => {
    expect(readingTabs("/reading/suggestions").map((t) => t.current)).toEqual([false, false, false, false, false, true, false]);
  });

  it("lights Stats on the stats page and on the Year in review (SLN-456)", () => {
    expect(readingTabs("/reading/stats").map((t) => t.current)).toEqual([false, false, false, false, true, false, false]);
    expect(readingTabs("/reading/year").map((t) => t.current)).toEqual([false, false, false, false, true, false, false]);
    expect(readingTabs("/reading/year/2025").map((t) => t.current)).toEqual([false, false, false, false, true, false, false]);
    expect(readingTabs("/reading/yearly").map((t) => t.current)).toEqual([false, false, false, false, false, false, false]);
  });
});

describe("hub words", () => {
  const day = { today: "2026-10-05", zone: "Europe/Amsterdam", dayStartHour: 4 };
  it("says when a book was last read in reading days", () => {
    // 01:30 on the 5th counts for the 4th: yesterday
    expect(lastReadText("2026-10-04T23:30:00Z", day)).toBe("yesterday");
    expect(lastReadText("2026-10-05T08:00:00Z", day)).toBe("today");
    expect(lastReadText("2026-10-01T08:00:00Z", day)).toBe("4 days ago");
    expect(lastReadText("2026-09-02T08:00:00Z", day)).toBe("2 Sep");
    expect(lastReadText("2025-09-02T08:00:00Z", day)).toBe("2 Sep 2025");
    expect(lastReadText(null, day)).toBeNull();
  });

  it("says how long ago a book was paused", () => {
    expect(agoText("2026-09-14T08:00:00Z", day)).toBe("3 weeks ago");
    expect(agoText("2026-10-02T08:00:00Z", day)).toBe("3 days ago");
    expect(agoText("2026-06-01T08:00:00Z", day)).toBe("4 months ago");
    expect(agoText("2023-10-01T08:00:00Z", day)).toBe("3 years ago");
  });

  it("names a book's reading state in the picker", () => {
    expect(pickerReadingState({ state: "reading", reads: 0, percent: 44.2 })).toBe("Reading 44%");
    expect(pickerReadingState({ state: "paused", reads: 0, percent: 10 })).toBe("Paused");
    expect(pickerReadingState({ state: "read", reads: 2, percent: null })).toBe("Read 2 times");
    expect(pickerReadingState({ state: "read", reads: 1, percent: null })).toBe("Read");
    expect(pickerReadingState({ state: "unread", reads: 0, percent: null })).toBeNull();
  });
});
