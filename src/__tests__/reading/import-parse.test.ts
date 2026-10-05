import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { csvTable, parseCsv } from "@/lib/reading/import/csv";
import { DURTAL_READING_COLUMNS } from "@/lib/reading/import/durtal-format";
import { detectFormat, GOODREADS_EXPORT_HEADER, UnknownFormatError } from "@/lib/reading/import/formats";
import { halfStar, review } from "@/lib/reading/import/fields";
import { parseImportFile } from "@/lib/reading/import/parse";
import { storygraphRanges } from "@/lib/reading/import/storygraph";
import { durtalImportRowKey, durtalReadingKey, goodreadsReadingKey, keyHash, storygraphReadingKey } from "@/lib/reading/source-keys";

/* The parsing layer of the reading import (SLN-450), on synthetic files
   written for the test, not Joris's data. */

const fixture = (name: string) => readFileSync(join(__dirname, "../fixtures/reading-import", name), "utf8");

describe("the CSV reader", () => {
  it("reads quotes, doubled quotes, commas and newlines in quotes", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi""\nthere"\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
    ]);
  });
  it("reads CRLF, a byte order mark and a trailing empty line", () => {
    expect(parseCsv("﻿a,b\r\n1,2\r\n\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
  it("never evaluates a cell", () => {
    expect(parseCsv('isbn\n="0140449132"\n')[1]).toEqual(['="0140449132"']);
  });
  it("strips the formula guard of Durtal's exports, and only that", () => {
    expect(parseCsv("a,b,c,d,e\n'=1+1,'+x,'-3,'@y,'plain\n")[1]).toEqual(["=1+1", "+x", "-3", "@y", "'plain"]);
  });
  it("gives a short row's missing cells as empty", () => {
    expect(csvTable("a,b,c\n1\n").rows).toEqual([{ a: "1", b: "", c: "" }]);
  });
});

describe("the format", () => {
  it("is read from the header names", () => {
    expect(detectFormat([...GOODREADS_EXPORT_HEADER])).toBe("goodreads");
    expect(detectFormat(GOODREADS_EXPORT_HEADER.filter((h) => h !== "Book Id"))).toBe("goodreads");
    expect(detectFormat(["Title", "Authors", "Read Status", "Star Rating"])).toBe("storygraph");
    expect(detectFormat([...DURTAL_READING_COLUMNS])).toBe("durtal");
  });
  it("refuses an unknown file and names its columns", () => {
    expect(() => detectFormat(["Name", "Price"])).toThrow(UnknownFormatError);
    expect(() => detectFormat(["Name", "Price"])).toThrow("This file is not a Goodreads, StoryGraph or Durtal export. Its columns: Name, Price");
  });
  it("keeps the Goodreads header in Goodreads' order", () => {
    expect(GOODREADS_EXPORT_HEADER).toHaveLength(24);
    expect(GOODREADS_EXPORT_HEADER.slice(0, 3)).toEqual(["Book Id", "Title", "Author"]);
    expect(GOODREADS_EXPORT_HEADER.at(-1)).toBe("Owned Copies");
  });
  it("keeps the Durtal columns in their order", () => {
    expect(DURTAL_READING_COLUMNS).toEqual([
      "reading_id", "work_id", "edition_id", "instance_id", "title", "authors", "isbn13", "status", "format", "unit",
      "total_pages", "total_minutes", "start_page", "current_page", "current_percent", "current_minutes", "current_chapter",
      "started_on", "started_precision", "finished_on", "finished_precision", "rating", "review_html", "abandon_reason",
      "abandon_note", "source_key",
    ]);
  });
});

describe("a review", () => {
  it("keeps Goodreads' bold and italics, and drops scripts", () => {
    expect(review('<b>Great</b> <i class="x">book</i><br/>Yes<script>alert(1)</script>')).toBe("<strong>Great</strong> <em>book</em><br />Yes");
  });
  it("turns plain text into paragraphs and escapes it", () => {
    expect(review("One & two\nthree\n\nfour <5")).toBe("<p>One &amp; two<br />three</p><p>four &lt;5</p>");
  });
  it("is null when empty", () => {
    expect(review("  ")).toBeNull();
    expect(review("<script>x</script>")).toBeNull();
  });
});

describe("half stars", () => {
  it("round to the nearest half, ties up; 0 is unrated", () => {
    expect([3.75, 3.25, 3.1, 4.5, 0.2, 0, 5].map(halfStar)).toEqual([4, 3.5, 3, 4.5, 0.5, null, 5]);
  });
});

describe("a Goodreads export", () => {
  const file = parseImportFile(fixture("goodreads.csv"));
  const row = (title: string) => file.rows.find((r) => r.title === title)!;

  it("is Goodreads, every column present", () => {
    expect(file.source).toBe("goodreads");
    expect(file.missing).toEqual([]);
    expect(file.rowNos).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("numbers a re-read: the undated earlier reads first, the dated one last", () => {
    const r = row("Crime and Punishment");
    expect(r.isbn13).toBe("9780140449136");
    expect(r.isbn10).toBe("0140449132");
    expect(r.readings.map((x) => [x.n, x.status, x.finishedOn, x.finishedPrecision, x.note ?? null])).toEqual([
      [1, "finished", null, "unknown", "Earlier read, date unknown"],
      [2, "finished", null, "unknown", "Earlier read, date unknown"],
      [3, "finished", "2019-04-14", "day", null],
    ]);
    expect(r.readings.map((x) => x.sourceKey)).toEqual([1, 2, 3].map((n) => `goodreads:1001#${n}`));
    expect(r.readings.every((x) => x.startedPrecision === "unknown" && x.startedOn === null)).toBe(true);
    expect(r.readings[2].rating).toBe(4);
    expect(r.readings[0].rating).toBeNull();
    expect(r.rating).toBe(4);
    expect(r.warnings).toContain("Goodreads keeps only the last read date");
  });
  it("sanitizes the review and keeps the private notes", () => {
    const r = row("Crime and Punishment");
    expect(r.readings[2].reviewHtml).toContain("<strong>Great</strong>");
    expect(r.readings[2].reviewHtml).not.toContain("script");
    expect(r.privateNotes).toBe("Lent to Ana");
    expect(r.pages).toBe(671);
  });
  it("opens a currently-reading book after its earlier reads", () => {
    const r = row("L'Assommoir (Les Rougon-Macquart, #7)");
    expect(r.readings.map((x) => [x.n, x.status, x.finishedOn])).toEqual([
      [1, "finished", "2015-06-01"],
      [2, "reading", null],
    ]);
    expect(r.readings[1].finishedPrecision).toBe("unknown");
    expect(r.rating).toBeNull();
  });
  it("reads a DNF shelf in any case as an abandoned read with its stop date", () => {
    const r = row("Ulysses");
    expect(r.readings).toHaveLength(1);
    expect(r.readings[0]).toMatchObject({ status: "abandoned", finishedOn: "2020-01-02", finishedPrecision: "day", rating: null, abandonReason: null });
  });
  it("keeps to-read rows out of the readings", () => {
    const r = row("The Recognitions");
    expect(r.kind).toBe("to_read");
    expect(r.readings).toEqual([]);
  });
  it("keys a row with no Book Id by its ISBN, else by its title and author", () => {
    expect(row("Nadja").readings[0].sourceKey).toBe("goodreads:isbn13:9780141182803#1");
    expect(row("Là-bas").readings[0].sourceKey).toBe(`goodreads:title:${keyHash("Là-bas", "J.-K. Huysmans")}#1`);
    expect(row("Là-bas").readings[0].sourceKey).toBe(goodreadsReadingKey({ title: "Là-bas", firstAuthor: "J.-K. Huysmans" }, 1));
  });
  it("reads an on-hold shelf as paused, and an ISBN-10 as its ISBN-13 too", () => {
    const r = row("À rebours");
    expect(r.readings.map((x) => [x.n, x.status])).toEqual([[1, "paused"]]);
    expect(r.isbn10).toBe("2070360245");
    expect(r.isbn13).toBe("9782070360246");
  });
  it("drops an ISBN whose check digit is wrong", () => {
    expect(row("Bad ISBN")).toMatchObject({ isbn13: null, isbn10: null });
  });
  it("says which columns a short export lacks", () => {
    const short = parseImportFile(fixture("goodreads-short.csv"));
    expect(short.source).toBe("goodreads");
    expect(short.missing).toEqual([
      "This file has no Date Read column; reads will have no finish date",
      "This file has no Read Count column; each book is read once",
      "This file has no Book Id column; books are told apart by ISBN or title",
      "This file has no My Review column; no reviews are imported",
    ]);
    expect(short.rows[0].readings.map((x) => [x.n, x.status, x.sourceKey])).toEqual([[1, "finished", "goodreads:isbn13:9780141182803#1"]]);
  });
  it("accepts mixed precisions and refuses an inverted range (Date Started)", () => {
    const header = [...GOODREADS_EXPORT_HEADER, "Date Started"].join(",");
    const line = (start: string, read: string) => {
      const cells: Record<string, string> = { "Book Id": "9", Title: "T", Author: "A", "Exclusive Shelf": "read", "Read Count": "1", "Date Read": read };
      return [...GOODREADS_EXPORT_HEADER.map((h): string => cells[h] ?? ""), start].join(",");
    };
    const ok = parseImportFile(`${header}\n${line("2019/04/14", "2019/04/20")}\n`).rows[0];
    expect(ok.error).toBeNull();
    expect(ok.readings[0]).toMatchObject({ startedOn: "2019-04-14", startedPrecision: "day" });
    const bad = parseImportFile(`${header}\n${line("2019/04/14", "2019/04/02")}\n`).rows[0];
    expect(bad.error).toBe("The finish date is before the start date");
  });
});

describe("a StoryGraph export", () => {
  const file = parseImportFile(fixture("storygraph.csv"));
  const row = (title: string) => file.rows.find((r) => r.title === title)!;
  const key = (title: string, author: string, isbn13: string | null, n: number) => storygraphReadingKey({ title, firstAuthor: author, isbn13 }, n);

  it("makes one read per range, oldest first, with start and finish days", () => {
    const r = row("Crime and Punishment");
    expect(file.source).toBe("storygraph");
    expect(r.readings.map((x) => [x.n, x.status, x.startedOn, x.finishedOn, x.format])).toEqual([
      [1, "finished", "2021-03-01", "2021-04-02", "print"],
      [2, "finished", "2023-01-05", "2023-02-10", "print"],
    ]);
    expect(r.readings.map((x) => x.sourceKey)).toEqual([1, 2].map((n) => key("Crime and Punishment", "Fyodor Dostoevsky", "9780140449136", n)));
  });
  it("rounds quarter stars and shows the file's value", () => {
    const r = row("Crime and Punishment");
    expect(r.fileRating).toBe(3.75);
    expect(r.rating).toBe(4);
    expect(r.readings[1].rating).toBe(4);
    expect(r.readings[0].rating).toBeNull();
    expect(r.warnings).toContain("3.75, saved as 4");
    expect(r.readings[1].reviewHtml).toBe("Second time <em>better</em>");
  });
  it("keeps moods, pace and tags in the row, not in the readings", () => {
    expect(row("Crime and Punishment").extras).toEqual({ Moods: "dark, reflective", Pace: "medium", Tags: "russian" });
  });
  it("opens the current read from its start-only range, after the closed ones", () => {
    const r = row("Nadja");
    expect(r.readings.map((x) => [x.n, x.status, x.startedOn, x.finishedOn, x.format, x.unit])).toEqual([
      [1, "finished", "2022-05-01", "2022-05-20", "audio", "minutes"],
      [2, "reading", "2024-09-01", null, "audio", "minutes"],
    ]);
    expect(r.readings[0].rating).toBe(3.5);
  });
  it("reads did-not-finish as abandoned with its stop day", () => {
    expect(row("Ulysses").readings).toMatchObject([{ status: "abandoned", startedOn: "2020-01-01", finishedOn: "2020-01-15", format: "ebook" }]);
  });
  it("falls back to the last date and the count", () => {
    const r = row("Là-bas");
    expect(r.readings.map((x) => [x.n, x.finishedOn, x.note ?? null])).toEqual([
      [1, null, "Earlier read, date unknown"],
      [2, "2019-07-07", null],
    ]);
    expect(r.warnings).toContain("This file keeps only the last read date");
  });
  it("keeps to-read rows out, and refuses an inverted range", () => {
    expect(row("The Recognitions").kind).toBe("to_read");
    expect(row("Backwards").error).toBe("The finish date is before the start date");
  });
  it("reads the range formats exports have used", () => {
    expect(storygraphRanges("2023/1/5-2023/2/10").ranges).toEqual([{ start: "2023-01-05", finish: "2023-02-10" }]);
    expect(storygraphRanges("2023-01-05 - 2023-02-10").ranges).toEqual([{ start: "2023-01-05", finish: "2023-02-10" }]);
    expect(storygraphRanges("2023/02/10").ranges).toEqual([{ start: null, finish: "2023-02-10" }]);
    expect(storygraphRanges("2023/02/10-").ranges).toEqual([{ start: "2023-02-10", finish: null }]);
    expect(storygraphRanges("sometime in May").unread).toEqual(["sometime in May"]);
  });
});

describe("a Durtal reading CSV", () => {
  const file = parseImportFile(fixture("durtal.csv"));
  const [stored, byId, handMade, badStatus, guarded, openFinish, inverted, pastEnd] = file.rows;

  it("is Durtal, and an extra column is ignored", () => {
    expect(file.source).toBe("durtal");
    expect(file.missing).toEqual([]);
    expect(file.rows).toHaveLength(8);
  });
  it("keys a row by its stored key, else its reading id, else its cells", () => {
    expect(stored.readings[0].sourceKey).toBe("goodreads:1001#3");
    expect(byId.readings[0].sourceKey).toBe(durtalReadingKey("44444444-4444-4444-8444-444444444444"));
    const cells = parseCsv(fixture("durtal.csv"))[3].slice(0, DURTAL_READING_COLUMNS.length);
    expect(handMade.readings[0].sourceKey).toBe(durtalImportRowKey(cells));
  });
  it("carries the ids, the rating and the review", () => {
    expect(stored).toMatchObject({ workId: "22222222-2222-4222-8222-222222222222", editionId: "33333333-3333-4333-8333-333333333333", rating: 4.5 });
    expect(stored.readings[0]).toMatchObject({ readingId: "11111111-1111-4111-8111-111111111111", rating: 4.5, reviewHtml: "<p>Fine</p>", position: null });
  });
  it("keeps an open reading's position", () => {
    expect(byId.readings[0]).toMatchObject({ status: "reading", position: { page: 50 }, totalPages: 671, unit: "pages" });
  });
  it("accepts mixed precisions and splits the authors", () => {
    expect(handMade.error).toBeNull();
    expect(handMade.authors).toEqual(["André Breton", "Someone Else"]);
    expect(handMade.readings[0]).toMatchObject({ startedPrecision: "day", finishedOn: "2019-04-01", finishedPrecision: "month", format: "print" });
  });
  it("refuses values outside the tracker's lists, and says why", () => {
    expect(badStatus.error).toBe('status "done" is not one of reading, paused, finished, abandoned');
    expect(openFinish.error).toBe("An open reading has no finish date");
    expect(inverted.error).toBe("The finish date is before the start date");
    expect(pastEnd.error).toBe("current_page 120 is past the last page, 100");
  });
  it("strips the formula guard and reads an audio abandon", () => {
    expect(guarded.title).toBe("=Not a formula");
    expect(guarded.error).toBeNull();
    expect(guarded.readings[0]).toMatchObject({ status: "abandoned", unit: "minutes", abandonReason: "prose", abandonNote: "Too slow", position: { minutes: 120 } });
  });
});
