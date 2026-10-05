import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { API_SORTS, LIBRARY_SORTS, parseReadingFilters } from "@/lib/reading/filter-params";
import { cardReadingLabel, cardReadingOf, cardReadingTooltip, readingBadge } from "@/lib/reading/card";
import { authorReadingTabOf, inReadingTab, readOfText, readingRecordOf } from "@/lib/reading/record";
import { BOOK_SORTS, domainSwitchHref } from "@/lib/catalogue/domain-switch";
import { withNewColumns } from "@/lib/utils/column-config";
import { ALL_COLUMNS } from "@/components/books/book-data-table";

// Reading across the library (SLN-449): the shared parser, the card and list
// words, the author and series records, the collection switch and columns.

const parse = (query: string, sorts: readonly string[] = LIBRARY_SORTS) => parseReadingFilters(new URLSearchParams(query), { sorts });

describe("parseReadingFilters", () => {
  it("reads every parameter", () => {
    const { filters, sort, issues } = parse("reading=unread,reading&readFrom=2020&readTo=2025&reread=true&holding=owned&status=accessioned,wanted&sort=lastRead");
    expect(issues).toEqual([]);
    expect(sort).toBe("lastRead");
    expect(filters).toEqual({
      reading: ["unread", "reading"],
      readFrom: 2020,
      readTo: 2025,
      reread: true,
      holding: "owned",
      catalogueStatus: ["accessioned", "wanted"],
    });
  });

  it("keeps the valid values, drops the rest and reports each one", () => {
    const { filters, sort, issues } = parse("reading=unread,someday&readFrom=20x&reread=yes&holding=mine&status=owned,bogus,wanted&sort=pages");
    expect(filters).toEqual({ reading: ["unread"], catalogueStatus: ["wanted"] });
    expect(sort).toBeUndefined();
    expect(issues.map((i) => i.path[0]).sort()).toEqual(["holding", "readFrom", "reading", "reread", "sort", "status", "status"]);
  });

  it("drops status=owned and status=bogus before any SQL: Owned is the Holding filter", () => {
    expect(parse("status=owned").filters).toEqual({});
    expect(parse("status=bogus").filters).toEqual({});
    expect(parse("status=owned").issues).toHaveLength(1);
  });

  it("reads both holding values, or neither, as no holding filter", () => {
    expect(parse("holding=owned,not_owned").filters.holding).toBeUndefined();
    expect(parse("holding=owned,not_owned").issues).toEqual([]);
    expect(parse("holding=not_owned").filters.holding).toBe("not_owned");
    expect(parse("holding=owned,owned").filters.holding).toBe("owned");
    expect(parse("").filters).toEqual({});
  });

  it("swaps reversed years and takes one end alone", () => {
    expect(parse("readFrom=2025&readTo=2012").filters).toMatchObject({ readFrom: 2012, readTo: 2025 });
    expect(parse("readTo=2019").filters).toEqual({ readTo: 2019 });
  });

  it("checks the sort against the list it is given: the API has no author sorts", () => {
    expect(parse("sort=authorLastName").sort).toBe("authorLastName");
    expect(parse("sort=authorLastName", API_SORTS).issues).toHaveLength(1);
    expect(parse("sort=lastRead", API_SORTS).sort).toBe("lastRead");
    expect([...BOOK_SORTS].sort()).toEqual([...LIBRARY_SORTS].sort());
  });
});

describe("the card's reading", () => {
  it("is only an open reading's state and percent", () => {
    expect(cardReadingOf({ readingState: "reading", readingPercent: 44.17 })).toEqual({ state: "reading", percent: 44.17 });
    expect(cardReadingOf({ readingState: "paused", readingPercent: null })).toEqual({ state: "paused", percent: null });
    expect(cardReadingOf({ readingState: "read", readingPercent: null })).toBeUndefined();
    expect(cardReadingOf({})).toBeUndefined();
  });

  it("reads Reading 44%, Paused 44% or Reading, and adds itself to the status tooltip", () => {
    expect(cardReadingLabel({ state: "reading", percent: 44.17 })).toBe("Reading 44%");
    expect(cardReadingLabel({ state: "paused", percent: 44.6 })).toBe("Paused 45%");
    expect(cardReadingLabel({ state: "reading", percent: null })).toBe("Reading");
    expect(cardReadingTooltip("Accessioned · High priority · 2 copies", { state: "reading", percent: 44.17 })).toBe(
      "Accessioned · High priority · 2 copies · Reading, 44%",
    );
    expect(cardReadingTooltip("Wanted", { state: "paused", percent: null })).toBe("Wanted · Paused");
  });

  it("gives the list its badge", () => {
    expect(readingBadge({ state: "reading", timesRead: 1, percent: 44.2 })).toEqual({ label: "Reading 44%", variant: "blue" });
    expect(readingBadge({ state: "paused", timesRead: 0, percent: 10 })).toEqual({ label: "Paused 10%", variant: "muted" });
    expect(readingBadge({ state: "read", timesRead: 1, percent: null })).toEqual({ label: "Read", variant: "sage" });
    expect(readingBadge({ state: "read", timesRead: 3, percent: null })).toEqual({ label: "Read 3×", variant: "sage" });
    expect(readingBadge({ state: "abandoned", timesRead: 0, percent: null })).toEqual({ label: "Abandoned", variant: "muted" });
    expect(readingBadge({ state: "unread", timesRead: 0, percent: null })).toBeNull();
    // Before the summaries load: the card's open reading
    expect(readingBadge(undefined, { state: "reading", percent: 12 })).toEqual({ label: "Reading 12%", variant: "blue" });
    expect(readingBadge(undefined, undefined)).toBeNull();
  });
});

describe("an author's or a series' reading record", () => {
  const books = [
    { timesRead: 1, rating: 4, lastReadAt: "2024-05-01 10:00:00+00" },
    { timesRead: 2, rating: "4.5", lastReadAt: "2025-01-02 10:00:00+00" },
    { timesRead: 0, rating: null, lastReadAt: null },
    { timesRead: 0, rating: 3, lastReadAt: "2026-09-01 10:00:00+00" },
  ];
  it("counts a book read once or more, re-reads, the books' average and the last read", () => {
    expect(readingRecordOf(books)).toEqual({ total: 4, read: 2, rereads: 1, average: 3.8, lastReadAt: "2026-09-01 10:00:00+00" });
    expect(readOfText(readingRecordOf(books))).toBe("Read 2 of 4");
    expect(readOfText({ total: 3, read: 0 })).toBeNull();
    expect(readingRecordOf([]).average).toBeNull();
  });

  it("filters the author's books by tab", () => {
    expect(authorReadingTabOf("unread")).toBe("unread");
    expect(authorReadingTabOf(["read"])).toBe("read");
    expect(authorReadingTabOf("bogus")).toBe("all");
    expect(inReadingTab("reading", "paused")).toBe(true);
    expect(inReadingTab("reading", "reading")).toBe(true);
    expect(inReadingTab("read", "abandoned")).toBe(false);
    expect(inReadingTab("all", "abandoned")).toBe(true);
  });
});

describe("domainSwitchHref", () => {
  const current = new URLSearchParams("q=x&reading=unread&readFrom=2020&readTo=2024&reread=true&holding=owned&sort=lastRead&order=asc");
  it("keeps the reading parameters and the Last read sort on books", () => {
    const href = new URL(domainSwitchHref("book", current), "http://x");
    expect(Object.fromEntries(href.searchParams)).toEqual({
      q: "x",
      reading: "unread",
      readFrom: "2020",
      readTo: "2024",
      reread: "true",
      holding: "owned",
      sort: "lastRead",
      order: "asc",
    });
  });
  it("keeps only holding for films, and drops the reading parameters and the Last read sort", () => {
    const href = new URL(domainSwitchHref("film", current), "http://x");
    expect(Object.fromEntries(href.searchParams)).toEqual({ q: "x", holding: "owned" });
  });
});

describe("the table's reading columns", () => {
  it("join a saved column choice hidden, after the saved ones, so the column dialog offers them", () => {
    const saved = [
      { key: "title", visible: true, order: 0 },
      { key: "rating", visible: true, order: 1 },
    ];
    const merged = withNewColumns(saved, ALL_COLUMNS);
    for (const key of ["readingState", "lastReadAt", "timesRead", "readingPercent"]) {
      const column = merged.find((c) => c.key === key);
      expect(column, key).toMatchObject({ visible: false });
      expect(column!.order).toBeGreaterThan(1);
    }
    expect(merged.slice(0, 2)).toEqual(saved);
  });
});

describe("every card mapper passes the reading", () => {
  const root = path.resolve(__dirname, "../../..");
  it.each([
    "src/app/library/page.tsx",
    "src/app/page.tsx",
    "src/components/books/work-carousel.tsx",
    "src/app/people/[slug]/page.tsx",
    "src/app/recommenders/[id]/page.tsx",
    "src/app/taxonomy/[familySlug]/[itemSlug]/page.tsx",
    "src/lib/publishers/books.ts",
  ])("%s", (file) => {
    expect(readFileSync(path.join(root, file), "utf8")).toMatch(/reading(:|=\{)\s*cardReadingOf\(/);
  });
});
