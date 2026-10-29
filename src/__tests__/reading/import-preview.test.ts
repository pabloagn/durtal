import { describe, expect, it } from "vitest";
import { bookVerdicts, defaultDecision, judgeCandidates, matchTitle, importableAnyway, ratingState, sectionOf } from "@/lib/reading/import/match-rules";
import { addBookHref, cannotCarry, commitWords, fileLine, ratingLine, summaryLine, writeLine, sessionPreviewLine } from "@/lib/reading/import/preview-text";
import { rowView } from "@/lib/reading/import/row-view";
import type { ImportReading } from "@/lib/reading/import/types";

/* The import's pure rules and words (SLN-450): title normalization, the
   likely bar, sections, defaults, verdicts and what the preview says. */

const reading = (over: Partial<ImportReading>): ImportReading => ({
  n: 1,
  status: "finished",
  startedOn: null,
  startedPrecision: "unknown",
  finishedOn: null,
  finishedPrecision: "unknown",
  format: "print",
  unit: "pages",
  totalPages: null,
  totalMinutes: null,
  position: null,
  rating: null,
  reviewHtml: null,
  abandonReason: null,
  abandonNote: null,
  readingId: null,
  sourceKey: `k#${over.n ?? 1}`,
  ...over,
});

describe("titles as matching compares them", () => {
  it("drops a series marker and a subtitle", () => {
    expect(matchTitle("L'Assommoir (Les Rougon-Macquart, #7)")).toBe("L'Assommoir");
    expect(matchTitle("Watt: A Novel")).toBe("Watt");
    expect(matchTitle("The Name of the Rose (Book 1)")).toBe("The Name of the Rose (Book 1)");
    expect(matchTitle("Dune (Dune, #1.5)")).toBe("Dune");
    expect(matchTitle(": only a colon")).toBe(": only a colon");
  });
});

describe("candidates", () => {
  it("is likely only for one book over the bar with its author", () => {
    expect(judgeCandidates([{ workId: "a", score: 0.92, byAuthor: true }])).toMatchObject({ found: "likely", workId: "a", reason: "Title and author, 92%" });
    const two = judgeCandidates([
      { workId: "a", score: 0.9, byAuthor: true },
      { workId: "b", score: 0.85, byAuthor: true },
    ]);
    expect([two.found, two.candidates.map((c) => c.workId)]).toEqual(["possible", ["a", "b"]]);
    expect(judgeCandidates([{ workId: "a", score: 1, byAuthor: false }]).found).toBe("possible");
    // The one same title among close ones: "The Familiar, Volume 5" among volumes 1 to 4
    expect(
      judgeCandidates([
        { workId: "v4", score: 0.909, byAuthor: true },
        { workId: "v5", score: 1, byAuthor: true },
        { workId: "v1", score: 0.909, byAuthor: true },
      ]),
    ).toMatchObject({ found: "likely", workId: "v5", reason: "Title and author, 100%" });
    // Two books with the same title and author: a duplicate to choose from
    expect(judgeCandidates([{ workId: "a", score: 1, byAuthor: true }, { workId: "b", score: 1, byAuthor: true }]).found).toBe("possible");
    expect(judgeCandidates([{ workId: "a", score: 0.6, byAuthor: true }]).found).toBe("possible");
    expect(judgeCandidates([{ workId: "a", score: 0.4, byAuthor: true }]).found).toBe("none");
    expect(judgeCandidates([]).found).toBe("none");
  });
  it("shows at most three, author matches first", () => {
    const many = judgeCandidates(["a", "b", "c", "d"].map((workId, i) => ({ workId, score: 0.7 - i / 100, byAuthor: i > 0 })));
    expect(many.candidates.map((c) => c.workId)).toEqual(["b", "c", "d"]);
  });
});

describe("sections and decisions", () => {
  const row = { error: null, kind: "readings" as const };
  it("puts each row where it belongs", () => {
    expect(sectionOf({ ...row, error: "Bad" }, "exact", "w", []).section).toBe("cannot");
    expect(sectionOf({ ...row, kind: "to_read" }, "exact", "w", []).section).toBe("not_imported");
    expect(sectionOf(row, "possible", null, []).section).toBe("choose");
    expect(sectionOf(row, "none", null, []).section).toBe("none");
    expect(sectionOf(row, "likely", "w", [{ n: 1, verdict: "new", reason: null, readingId: null }]).section).toBe("likely");
    expect(sectionOf(row, "exact", "w", [{ n: 1, verdict: "already_present", reason: "Same source", readingId: "r" }])).toEqual({ section: "present", note: "Same source" });
    expect(sectionOf(row, "exact", "w", [{ n: 1, verdict: "refused", reason: "No", readingId: null }])).toEqual({ section: "cannot", note: "No" });
  });
  it("imports exact rows and skips the closed ones by default", () => {
    expect(["exact", "likely", "choose", "none", "present", "cannot", "not_imported"].map((s) => defaultDecision(s as never))).toEqual([
      "import",
      "pending",
      "pending",
      "pending",
      "skip",
      "skip",
      "skip",
    ]);
  });
});

describe("a book's verdicts", () => {
  const existing = [
    { id: "dated", sourceKey: null, status: "finished" as const, finishedOn: "2019-04-14", finishedPrecision: "day" as const },
    { id: "old", sourceKey: null, status: "finished" as const, finishedOn: "2015-01-01", finishedPrecision: "year" as const },
  ];
  it("counts undated reads against the readings no dated row matched", () => {
    const [v] = bookVerdicts("goodreads", [{ readings: [reading({ n: 1 }), reading({ n: 2 }), reading({ n: 3, finishedOn: "2019-04-14", finishedPrecision: "day" })] }], existing);
    expect(v.map((x) => [x.verdict, x.reason, x.readingId])).toEqual([
      ["already_present", "Undated read", "old"],
      ["new", null, null],
      ["already_present", "Same finish date", "dated"],
    ]);
    expect(importableAnyway(v)).toBe(false);
    expect(importableAnyway([v[0]])).toBe(true);
  });
  it("treats an open read for a book being read by its source", () => {
    const open = [{ id: "open", sourceKey: null, status: "reading" as const, finishedOn: null, finishedPrecision: "unknown" as const }];
    expect(bookVerdicts("goodreads", [{ readings: [reading({ status: "reading" })] }], open)[0][0]).toMatchObject({ verdict: "already_present", reason: "Already open in Durtal", readingId: "open" });
    expect(bookVerdicts("durtal", [{ readings: [reading({ status: "paused" })] }], open)[0][0]).toMatchObject({ verdict: "refused", reason: "This book already has an open reading" });
    const two = bookVerdicts("storygraph", [{ readings: [reading({ status: "reading" })] }, { readings: [reading({ status: "reading", sourceKey: "other" })] }], []);
    expect(two.map((v) => v[0].verdict)).toEqual(["new", "refused"]);
  });
});

describe("the preview's words", () => {
  const today = "2026-10-05";
  it("says what the file says", () => {
    expect(fileLine({ authors: ["Émile Zola"], fileRating: 3.75, kind: "readings", readings: [reading({ finishedOn: "2019-04-14", finishedPrecision: "day" })] }, today)).toBe(
      "Émile Zola · Finished 14 Apr 2019 · 3.75 stars",
    );
    expect(fileLine({ authors: ["A"], fileRating: null, kind: "to_read", readings: [] }, today)).toBe("A · Want to read");
  });
  it("says what will be written", () => {
    const reads = [reading({ n: 1 }), reading({ n: 2 }), reading({ n: 3, finishedOn: "2019-04-14", finishedPrecision: "day", rating: 4 })];
    const fresh = { n: 0, verdict: "new" as const, reason: null, readingId: null };
    expect(writeLine(reads.map((r) => ({ ...r, hasReview: r.n === 3 })), [fresh, fresh, fresh], today)).toBe(
      "Finished 14 Apr 2019 · 4 stars · review · +2 earlier reads, dates unknown",
    );
    const undated = { n: 0, verdict: "already_present" as const, reason: "Undated read", readingId: "x" };
    expect(writeLine([reading({ n: 1 }), reading({ n: 2 })], [undated, fresh], today)).toBe("Finished, date unknown · 1 earlier read already in Durtal");
    expect(writeLine([reading({ n: 1 })], [undated], today)).toBe("1 earlier read already in Durtal");
    expect(writeLine([reading({ n: 1 })], [undated], today, { anyway: true })).toBe("Finished, date unknown");
    expect(writeLine([reading({ status: "reading", startedOn: "2026-09-01", startedPrecision: "day" })], [fresh], today)).toBe("Reading, started 1 Sep");
  });
  it("names an abandoned read whatever its dates (SLN-1099)", () => {
    const line = (over: Partial<ImportReading>) => fileLine({ authors: ["A"], fileRating: null, kind: "readings", readings: [reading({ status: "abandoned", ...over })] }, today);
    expect(line({ finishedOn: "2019-04-14", finishedPrecision: "day" })).toBe("A · Abandoned 14 Apr 2019");
    expect(line({ startedOn: "2019-04-14", startedPrecision: "day", finishedOn: "2019-04-14", finishedPrecision: "day" })).toBe("A · Abandoned, 14 Apr 2019");
    expect(line({ startedOn: "2019-04-03", startedPrecision: "day", finishedOn: "2019-04-14", finishedPrecision: "day" })).toBe("A · Abandoned, 3 to 14 Apr 2019");
    expect(line({ startedOn: "2018-12-01", startedPrecision: "month", finishedOn: "2019-02-01", finishedPrecision: "month" })).toBe("A · Abandoned, Dec 2018 to Feb 2019");
    expect(line({})).toBe("A · Abandoned, date unknown");
  });
  it("never changes a book rating without saying so", () => {
    const base = { section: "exact" as const, fileRating: 4, useFileRating: false, writes: true };
    expect(ratingLine({ ...base, bookRating: null })).toEqual({ text: "Book rating set to 4: the book has none", choice: false });
    expect(ratingLine({ ...base, bookRating: 3 })).toEqual({ text: "Book rating 3 kept (the file says 4)", choice: true });
    expect(ratingLine({ ...base, bookRating: 3, useFileRating: true })).toEqual({ text: "Book rating 3 replaced by 4", choice: true });
    expect(ratingLine({ ...base, bookRating: 4 })).toBeNull();
    expect(ratingLine({ ...base, bookRating: 3, writes: false })).toBeNull();
    expect(ratingLine({ ...base, bookRating: 3, section: "present" })).toBeNull();
  });
  it("adds a book by its ISBN, else by its title and author", () => {
    expect(addBookHref({ isbn13: "9780140449136", title: "Crime and Punishment", authors: ["Fyodor Dostoevsky"] })).toBe("/library/new?isbn=9780140449136");
    expect(addBookHref({ isbn13: null, title: "Là-bas", authors: ["J.-K. Huysmans"] })).toBe("/library/new?q=L%C3%A0-bas+J.-K.+Huysmans");
  });
  it("sums up the file and the commit", () => {
    expect(
      summaryLine({
        rows: 1204,
        wantToRead: 412,
        ratingsDiffer: 6,
        sections: { exact: 980, likely: 120, choose: 60, none: 44, to_read: 412, present: 18, cannot: 0, not_imported: 0 },
      }),
    ).toBe("1,204 rows · 980 exact · 120 likely · 60 to choose · 44 not in Durtal · 412 want to read · 18 already in Durtal · 6 book ratings differ");
    expect(commitWords(1142, 60)).toEqual({ label: "Import 1,142 readings", note: "60 rows not decided yet are left out" });
    expect(commitWords(1, 0)).toEqual({ label: "Import 1 reading", note: null });
    // To-read rows go to Up next (SLN-452); a re-imported file offers only them
    expect(commitWords(0, 0, 412).label).toBe("Add 412 books to Up next");
    expect(commitWords(3, 0, 1).label).toBe("Import 3 readings and add 1 book to Up next");
    // Private notes (SLN-453): named beside the readings
    expect(commitWords(1142, 0, 0, 23).label).toBe("Import 1,142 readings and 23 notes");
    expect(commitWords(0, 0, 0, 1).label).toBe("Import 1 note");
    expect(commitWords(3, 0, 2, 1).label).toBe("Import 3 readings and 1 note, and add 2 books to Up next");
    expect(commitWords(0, 0, 2, 4).label).toBe("Import 4 notes and add 2 books to Up next");
  });
  it("says what each format cannot carry", () => {
    // Private notes are imported now (SLN-453): the box no longer counts them
    expect(cannotCarry("goodreads", { otherShelves: 2, extras: 0 }, ["This file has no Date Read column; reads will have no finish date"])).toEqual([
      "Goodreads keeps no start dates: imported reads start on an unknown date.",
      "Goodreads keeps only the last read date: earlier reads have no dates.",
      "2 books on shelves that are neither read nor to-read are kept but not imported.",
      "This file has no Date Read column; reads will have no finish date",
    ]);
    expect(cannotCarry("storygraph", { otherShelves: 0, extras: 3 }, [])[1]).toBe(
      "Moods, pace, character questions, content warnings and tags of 3 books are kept but not imported.",
    );
  });
});

describe("ID-only commit labels", () => {
  it("names eligible IDs without promising another reading", () => {
    expect(commitWords(0, 0, 0, 0, 0, 0, 1)).toEqual({ label: "Record 1 Goodreads ID", note: null });
    expect(commitWords(0, 2, 0, 0, 0, 0, 2)).toEqual({ label: "Record 2 Goodreads IDs", note: "2 rows not decided yet are left out" });
    expect(commitWords(1, 0, 0, 0, 0, 0, 1).label).toBe("Import 1 reading and record 1 Goodreads ID");
    expect(commitWords(0, 0, 0, 0, 0, 0, 0).label).toBe("Nothing to import");
  });
});

describe("historical session preview words", () => {
  const base = { readOn: "1969-12-31", startPage: null, endPage: null, startPercent: 25, endPercent: 50, durationSeconds: null };
  it.each([[1, "under a minute"], [60, "1 min"], [120, "2 min"], [3600, "1 h"], [3661, "1 h 1 min"]] as const)(
    "shows %i seconds using the session list's duration words", (seconds, words) => {
      const input = Object.freeze({ ...base, durationSeconds: seconds });
      expect(sessionPreviewLine(input)).toBe(`31 Dec 1969 · 25–50% · ${words}`);
      expect(input).toEqual({ ...base, durationSeconds: seconds });
    },
  );
  it("handles null or absent reading days without deriving them from a timestamp", () => {
    const { readOn: _day, ...withoutDay } = base;
    expect(sessionPreviewLine({ ...base, readOn: null })).toBe("Date unknown · 25–50%");
    expect(sessionPreviewLine(withoutDay)).toBe("Date unknown · 25–50%");
  });
  it("keeps page ranges and absent durations readable without inventing values", () => {
    expect(sessionPreviewLine({ ...base, startPage: 0, endPage: 50 })).toBe("31 Dec 1969 · pages 0–50");
    expect(sessionPreviewLine({ ...base, startPage: null, endPage: 50 })).toBe("31 Dec 1969 · pages ?–50");
    expect(sessionPreviewLine({ ...base, startPercent: null, endPercent: null })).toBe("31 Dec 1969");
  });
});

describe("a row as the page sends it", () => {
  const today = "2026-10-05";
  const base = {
    rowNo: 3,
    section: "exact" as const,
    data: {
      kind: "readings" as const,
      sourceBookId: "77",
      title: "Watt",
      authors: ["Samuel Beckett"],
      isbn13: "9780140449136",
      isbn10: null,
      fileRating: 4,
      rating: 4,
      shelves: [],
      pages: null,
      extras: {},
      workId: null,
      editionId: null,
      instanceId: null,
      warnings: [],
      error: null,
      hasNotes: false,
      readings: [{ ...reading({ finishedOn: "2019-04-14", finishedPrecision: "day", rating: 4 }), hasReview: false }],
    },
    match: {
      found: "exact" as const,
      reason: "Same ISBN",
      chosen: false,
      editionId: "e",
      instanceId: null,
      candidates: [],
      verdicts: [{ n: 1, verdict: "new" as const, reason: null, readingId: null }],
      section: "exact" as const,
      note: null,
      warnings: [],
    },
    decision: "import" as const,
    useFileRating: false,
    written: null,
    book: { workId: "w", title: "Watt", slug: "watt", author: "Samuel Beckett", year: 1953, cover: null, rating: 3, editionWithoutGoodreads: true },
    candidates: [],
  };
  it("carries the words, the book and only the buttons the row has", () => {
    expect(rowView(base, today)).toEqual({
      rowNo: 3,
      title: "Watt",
      line: "Samuel Beckett · Finished 14 Apr 2019 · 4 stars",
      book: { href: "/library/watt", title: "Watt", line: "Samuel Beckett · 1953", cover: null },
      lines: [
        ["reason", "Same ISBN"],
        ["writes", "Finished 14 Apr 2019 · 4 stars"],
        ["rating", "Book rating 3 kept (the file says 4)"],
        ["note", "Checks and preserves Goodreads Book Id 77 for this book on commit"],
      ],
      actions: { decision: "import", canImport: true, canChoose: true, ratingChoice: false },
    });
  });
  it("shows an ID-only journal as pending remaining import, without losing its ownership", () => {
    const view = rowView({ ...base, written: { readings: [], bookRating: null, identifiers: ["id"], goodreadsClaim: { externalId: "77", key: "77", workId: "w" } } }, today);
    expect(view.lines).toContainEqual(["outcome", "Goodreads ID recorded; remaining import pending"]);
    expect(view.actions).toBeNull();
  });
  it("shows a written row's outcome and no buttons", () => {
    const view = rowView({ ...base, written: { readings: [{ n: 1, outcome: "written", readingId: "r", reason: null }], bookRating: null, identifiers: [] } }, today);
    expect([view.lines, view.actions]).toEqual([[["reason", "Same ISBN"], ["outcome", "Written"]], null]);
  });
  it("says one thing of a to-read book: it goes to Up next, or it stays where it is (SLN-956)", () => {
    const toRead = (queue: object | null) =>
      rowView({ ...base, section: "to_read", data: { ...base.data, kind: "to_read", queueKey: "q", readings: [] }, match: { ...base.match, section: "to_read", note: queue ? "Already in Up next, at 1" : null, queue: queue as never } }, today).lines;
    expect(toRead(null)).toContainEqual(["writes", "Goes to the bottom of Up next"]);
    const queued = toRead({ place: 1, sameKey: false, open: null, readYear: null });
    expect(queued).toContainEqual(["reason", "Same ISBN · Already in Up next, at 1"]);
    expect(queued.some(([kind]) => kind === "writes")).toBe(false);
    expect(toRead({ place: null, sameKey: false, open: "reading", readYear: null }).some(([kind]) => kind === "writes")).toBe(false);
  });
  it("offers Add this book on a row not in Durtal", () => {
    const view = rowView({ ...base, section: "none", book: null, match: { ...base.match, found: "none", reason: null, verdicts: [] } }, today);
    expect(view).toMatchObject({ empty: "Not in Durtal", actions: { decision: "import", canChoose: true, addHref: "/library/new?isbn=9780140449136" } });
  });
});

describe("an e-book library's ratings (SLN-658)", () => {
  const present = [{ n: 1, verdict: "already_present" as const, reason: "Same finish date", readingId: "r" }];
  const row = { error: null, kind: "readings" as const };
  it("tells a rating to set, one that differs and the same one", () => {
    expect([ratingState(4, null), ratingState(4, 3), ratingState(4, 4), ratingState(null, 3)]).toEqual(["set", "differs", "same", null]);
  });
  it("keeps a row importable while its rating is to settle, its read already in Durtal or not", () => {
    expect(sectionOf(row, "exact", "w", present, null, "differs")).toEqual({ section: "exact", note: null });
    expect(sectionOf(row, "exact", "w", present, null, "same")).toEqual({ section: "present", note: "Same finish date, Same rating" });
    expect(sectionOf(row, "exact", "w", [], null, "set")).toEqual({ section: "exact", note: null });
    expect(sectionOf(row, "exact", "w", [], null, "same")).toEqual({ section: "present", note: "Same rating" });
    // Other sources are as before
    expect(sectionOf(row, "exact", "w", present)).toEqual({ section: "present", note: "Same finish date" });
  });
  it("flags a library read beside another reading in Durtal, and keeps Durtal's by default", () => {
    const dated = [{ id: "d", sourceKey: null, status: "finished" as const, finishedOn: "2019-05-04", finishedPrecision: "day" as const }];
    const undated = [{ id: "u", sourceKey: null, status: "finished" as const, finishedOn: null, finishedPrecision: "unknown" as const }];
    const open = [{ id: "o", sourceKey: null, status: "reading" as const, finishedOn: null, finishedPrecision: "unknown" as const }];
    const read = reading({ finishedOn: "2021-03-03", finishedPrecision: "day" });
    const one = (existing: typeof dated | typeof undated | typeof open) => bookVerdicts("ebook_library", [{ readings: [read] }], existing)[0];
    expect(one(dated)).toEqual([{ n: 1, verdict: "already_present", reason: "Another read in Durtal", readingId: "d" }]);
    expect(one(undated)[0]).toMatchObject({ verdict: "already_present", reason: "Another read in Durtal", readingId: "u" });
    expect(one(open)[0]).toMatchObject({ verdict: "already_present", reason: "Being read in Durtal", readingId: "o" });
    // The same read, a book with no reading, and other sources are as before
    expect(bookVerdicts("ebook_library", [{ readings: [reading({ finishedOn: "2019-05-04", finishedPrecision: "day" })] }], dated)[0][0].reason).toBe("Same finish date");
    expect(one([])[0].verdict).toBe("new");
    expect(bookVerdicts("goodreads", [{ readings: [read] }], dated)[0][0].verdict).toBe("new");
    // Already in Durtal, so skipped by default, with Import anyway
    expect(sectionOf(row, "exact", "w", one(dated))).toEqual({ section: "present", note: "Another read in Durtal" });
    expect(defaultDecision("present")).toBe("skip");
    expect([importableAnyway(one(dated)), importableAnyway(one(open)), importableAnyway(present)]).toEqual([true, true, false]);
    expect(writeLine([read], one(dated), "2026-10-13")).toBe("Durtal's own reading kept: the library's read is not imported");
    expect(writeLine([read], one(dated), "2026-10-13", { anyway: true })).toContain("2021");
  });
  it("names the ratings in the commit, and what the import cannot carry", () => {
    expect(commitWords(2, 0, 0, 0, 3).label).toBe("Import 2 readings and 3 ratings");
    expect(commitWords(0, 0, 0, 0, 1).label).toBe("Import 1 rating");
    expect(commitWords(2, 0, 0, 1, 3).label).toBe("Import 2 readings, 1 note and 3 ratings");
    expect(cannotCarry("ebook_library", { otherShelves: 0, extras: 0 }, [])).toEqual([
      "Only the library's books that are e-books in Durtal, linked to their books, are here.",
      "The library keeps no start dates and one read a book: a reread is not imported.",
    ]);
  });
  it("offers the rating on a row whose read is already in Durtal, and shows what it settled", () => {
    const today = "2026-10-05";
    const data = {
      kind: "readings" as const,
      sourceBookId: null,
      title: "Watt",
      authors: ["Samuel Beckett"],
      isbn13: null,
      isbn10: null,
      fileRating: 4,
      rating: 4,
      shelves: [],
      pages: null,
      extras: {},
      workId: "w",
      editionId: "e",
      instanceId: "i",
      warnings: [],
      error: null,
      hasNotes: false,
      readings: [{ ...reading({ finishedOn: "2019-04-14", finishedPrecision: "day", format: "ebook", unit: "percent" }), hasReview: false }],
    };
    const view = {
      rowNo: 7,
      section: "exact" as const,
      data,
      match: { found: "exact" as const, reason: "Same Durtal book", chosen: false, editionId: "e", instanceId: "i", candidates: [], verdicts: present, section: "exact" as const, note: null, warnings: [], rating: "differs" as const },
      decision: "import" as const,
      useFileRating: false,
      written: null,
      book: { workId: "w", title: "Watt", slug: "watt", author: "Samuel Beckett", year: 1953, cover: null, rating: 3, editionWithoutGoodreads: true },
      candidates: [],
    };
    expect(rowView(view, today)).toMatchObject({
      lines: [
        ["reason", "Same Durtal book"],
        ["writes", "1 read already in Durtal"],
        ["rating", "Book rating 3 kept (the file says 4)"],
      ],
      actions: { decision: "import", canImport: true, ratingChoice: false },
    });
    const written = rowView({ ...view, written: { readings: [], bookRating: { workId: "w", before: 3, after: 4 }, identifiers: [], ratingOutcome: "written" } }, today);
    expect([written.lines, written.actions]).toEqual([[["reason", "Same Durtal book"], ["outcome", "Book rating set to 4"]], null]);
  });
});
