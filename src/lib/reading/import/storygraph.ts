import { storygraphReadingKey, storygraphToReadKey } from "../source-keys";
import type { ReadingFormat, ReadingStatus } from "../constants";
import { datesError, day, halfStar, int, isbns, review, shown, text } from "./fields";
import type { ImportReading, ImportRow, ParsedFile } from "./types";

/*
 * A StoryGraph export (SLN-450). `Dates Read` holds one range per read
 * ("2023/01/05-2023/02/10, 2021/03/01-2021/04/02"); without it, `Last Date
 * Read` and `Read Count` give one dated read and undated earlier ones, as for
 * Goodreads. Quarter stars round to the nearest half, ties up. Moods, pace,
 * tags and the like stay in the row's data, not imported.
 */

const STATUSES: Record<string, ReadingStatus | "to_read"> = {
  read: "finished",
  "currently-reading": "reading",
  "to-read": "to_read",
  "did-not-finish": "abandoned",
  paused: "paused",
};

const FORMATS: Record<string, ReadingFormat> = {
  paperback: "print",
  hardcover: "print",
  print: "print",
  digital: "ebook",
  ebook: "ebook",
  audio: "audio",
  audiobook: "audio",
};

/** Columns that are about the book, not the reading: kept for the enrichment epic */
const EXTRA_COLUMNS = [
  "Moods",
  "Pace",
  "Character- or Plot-Driven?",
  "Strong Character Development?",
  "Loveable Characters?",
  "Diverse Characters?",
  "Flawed Characters?",
  "Content Warnings",
  "Content Warning Description",
  "Tags",
  "Owned?",
];

const EARLIER = "Earlier read, date unknown";

type Period = { start: string | null; finish: string | null; note?: string };

/**
 * The ranges of a `Dates Read` cell, oldest first. "2023/01/05-2023/02/10" is
 * a read; "2023/02/10-" one with a start only; "2023/02/10" one with a finish
 * only. A piece with no readable date is reported in `unread`.
 */
export function storygraphRanges(cell: string | undefined): { ranges: Period[]; unread: string[] } {
  const ranges: Period[] = [];
  const unread: string[] = [];
  for (const piece of (cell ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
    const dates = (piece.match(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/g) ?? []).map((d) => day(d));
    if (dates.length >= 2 && dates[0] && dates[1]) ranges.push({ start: dates[0], finish: dates[1] });
    else if (dates.length === 1 && dates[0]) {
      const startOnly = /\d\s*-\s*$/.test(piece);
      ranges.push(startOnly ? { start: dates[0], finish: null } : { start: null, finish: dates[0] });
    } else unread.push(piece);
  }
  ranges.sort((a, b) => (a.finish ?? a.start ?? "").localeCompare(b.finish ?? b.start ?? ""));
  return { ranges, unread };
}

export function mapStorygraph(headers: string[], records: Record<string, string>[]): ParsedFile {
  const has = (h: string) => headers.includes(h);
  const missing: string[] = [];
  if (!has("Dates Read") && !has("Last Date Read")) missing.push("This file has no Dates Read or Last Date Read column; reads will have no dates");
  if (!has("Review")) missing.push("This file has no Review column; no reviews are imported");
  const rows = records.map((r): ImportRow => {
    const title = text(r["Title"], 500) ?? "";
    const authors = (r["Authors"] ?? "").split(",").map((a) => a.trim()).filter(Boolean).slice(0, 20).map((a) => a.slice(0, 300));
    const firstAuthor = authors[0] ?? "";
    const { isbn13, isbn10 } = isbns(r["ISBN/UID"], r["ISBN"]);
    const status = STATUSES[(r["Read Status"] ?? "").trim().toLowerCase()];
    const star = Number((r["Star Rating"] ?? "").trim());
    const fileRating = Number.isFinite(star) && star > 0 ? star : null;
    const rating = halfStar(fileRating);
    const reviewHtml = review(r["Review"]);
    const format = FORMATS[(r["Format"] ?? "").trim().toLowerCase()] ?? "print";
    const extras = Object.fromEntries(
      EXTRA_COLUMNS.filter((c) => (r[c] ?? "").trim()).map((c) => [c, (r[c] ?? "").trim().slice(0, 2000)]),
    );
    const warnings: string[] = [];
    if (fileRating !== null && rating !== fileRating) warnings.push(`${fileRating}, saved as ${rating}`);
    const key = (n: number) => storygraphReadingKey({ title, firstAuthor, isbn13 }, n);
    const row: ImportRow = {
      kind: "readings",
      sourceBookId: null,
      title,
      authors,
      isbn13,
      isbn10,
      fileRating,
      rating,
      reviewHtml,
      shelves: [],
      privateNotes: null,
      pages: null,
      extras,
      workId: null,
      editionId: null,
      instanceId: null,
      readings: [],
      warnings,
      error: null,
    };
    if (!title) {
      row.error = "The row has no title";
      return row;
    }
    if (!status) {
      row.error = `Unknown read status "${(r["Read Status"] ?? "").trim().slice(0, 40)}"`;
      return row;
    }
    if (status === "to_read") {
      // Up Next (SLN-452), oldest added first
      row.kind = "to_read";
      row.queueKey = storygraphToReadKey({ title, firstAuthor, isbn13 });
      row.addedOn = day(r["Date Added"]);
      return row;
    }
    const make = (n: number, s: ReadingStatus, start: string | null, finish: string | null, note?: string): ImportReading => ({
      n,
      status: s,
      startedOn: start,
      startedPrecision: start ? "day" : "unknown",
      finishedOn: s === "finished" || s === "abandoned" ? finish : null,
      finishedPrecision: (s === "finished" || s === "abandoned") && finish ? "day" : "unknown",
      format,
      unit: format === "audio" ? "minutes" : "pages",
      totalPages: null,
      totalMinutes: null,
      position: null,
      rating: null,
      reviewHtml: null,
      abandonReason: null,
      abandonNote: null,
      readingId: null,
      sourceKey: key(n),
      ...(note ? { note } : {}),
    });
    const { ranges, unread } = storygraphRanges(r["Dates Read"]);
    for (const piece of unread) warnings.push(`A date in Dates Read could not be read: "${shown(piece)}"`);
    const readCount = int(r["Read Count"], { max: 1000 }) ?? 0;
    const last = day(r["Last Date Read"]);
    const open = status === "reading" || status === "paused";
    // The closed reads, oldest first, and the open read's start
    let closed: Period[];
    let openStart: string | null = null;
    if (ranges.length) {
      const tail = ranges.at(-1)!;
      const openTail = open && tail.finish === null;
      closed = openTail ? ranges.slice(0, -1) : ranges;
      if (openTail) openStart = tail.start;
      // A read count above the dated reads: the others have no dates
      const undated = open ? 0 : Math.max(0, readCount - closed.length);
      if (undated) warnings.push(`${undated} earlier ${undated === 1 ? "read has" : "reads have"} no dates in this file`);
      closed = [...Array.from({ length: undated }, (): Period => ({ start: null, finish: null, note: EARLIER })), ...closed];
    } else {
      // No ranges: the last date and the count, as Goodreads gives them
      const reads = open ? readCount : Math.max(1, readCount);
      closed = Array.from({ length: reads }, (_, i): Period =>
        i === reads - 1 ? { start: null, finish: last } : { start: null, finish: null, note: EARLIER },
      );
      if (reads > 1) warnings.push("This file keeps only the last read date");
    }
    // The last closed read takes the file's status (finished or abandoned); earlier ones were finished
    const done = closed.map((p, i) => make(i + 1, !open && i === closed.length - 1 ? (status as ReadingStatus) : "finished", p.start, p.finish, p.note));
    if (open) done.push(make(closed.length + 1, status as ReadingStatus, openStart, null));
    // The rating goes on the latest finished read; the review on the latest read
    const latestFinished = [...done].reverse().find((x) => x.status === "finished");
    if (latestFinished) latestFinished.rating = rating;
    done[done.length - 1].reviewHtml = reviewHtml;
    row.readings = done;
    row.rating = latestFinished ? rating : null;
    for (const reading of done) {
      const error = datesError(reading);
      if (error) row.error = error;
    }
    return row;
  });
  return { source: "storygraph", rows, missing };
}
