import { describe, expect, it } from "vitest";
import { bookVerdicts, defaultDecision, judgeCandidates, matchTitle, onlyUndated, sectionOf } from "@/lib/reading/import/match-rules";
import { addBookHref, cannotCarry, commitWords, fileLine, ratingLine, summaryLine, writeLine } from "@/lib/reading/import/preview-text";
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
    expect(onlyUndated(v)).toBe(false);
    expect(onlyUndated([v[0]])).toBe(true);
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
        sections: { exact: 980, likely: 120, choose: 60, none: 44, present: 18, cannot: 0, not_imported: 412 },
      }),
    ).toBe("1,204 rows · 980 exact · 120 likely · 60 to choose · 44 not in Durtal · 412 want to read · 18 already in Durtal · 6 book ratings differ");
    expect(commitWords(1142, 60)).toEqual({ label: "Import 1,142 readings", note: "60 rows not decided yet are left out" });
    expect(commitWords(1, 0)).toEqual({ label: "Import 1 reading", note: null });
  });
  it("says what each format cannot carry", () => {
    expect(cannotCarry("goodreads", { wantToRead: 2, privateNotes: 1, extras: 0 }, ["This file has no Date Read column; reads will have no finish date"])).toEqual([
      "Goodreads keeps no start dates: imported reads start on an unknown date.",
      "Goodreads keeps only the last read date: earlier reads have no dates.",
      "2 want-to-read books are kept but not imported yet: Up next will take them.",
      "1 private note is kept but not imported yet: notes will take them.",
      "This file has no Date Read column; reads will have no finish date",
    ]);
    expect(cannotCarry("storygraph", { wantToRead: 0, privateNotes: 0, extras: 3 }, [])[1]).toBe(
      "Moods, pace, character questions, content warnings and tags of 3 books are kept but not imported.",
    );
  });
});
