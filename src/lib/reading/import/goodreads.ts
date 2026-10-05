import { goodreadsReadingKey } from "../source-keys";
import type { ReadingStatus } from "../constants";
import { datesError, day, halfStar, int, isbns, review, text } from "./fields";
import type { ImportReading, ImportRow, ParsedFile } from "./types";

/*
 * A Goodreads export (SLN-450). Goodreads keeps only the last read date: a
 * Read Count above 1 becomes earlier finished reads with unknown dates,
 * numbered before the dated one. Most rows have no start date. `Number of
 * Pages` stays on the row: the commit uses it only when the edition has none.
 */

const ABANDON_SHELVES = ["did-not-finish", "dnf", "abandoned", "abandon"];
const PAUSE_SHELVES = ["paused", "on-hold"];

const base = (n: number, status: ReadingStatus): Omit<ImportReading, "sourceKey"> => ({
  n,
  status,
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
});

export function mapGoodreads(headers: string[], records: Record<string, string>[]): ParsedFile {
  const has = (h: string) => headers.includes(h);
  const missing: string[] = [];
  if (!has("Date Read")) missing.push("This file has no Date Read column; reads will have no finish date");
  if (!has("Read Count")) missing.push("This file has no Read Count column; each book is read once");
  if (!has("Book Id")) missing.push("This file has no Book Id column; books are told apart by ISBN or title");
  if (!has("My Review")) missing.push("This file has no My Review column; no reviews are imported");
  const rows = records.map((r): ImportRow => {
    const title = text(r["Title"], 500) ?? "";
    const author = text(r["Author"], 300) ?? "";
    const additional = (r["Additional Authors"] ?? "").split(",").map((a) => a.trim()).filter(Boolean).slice(0, 20);
    const { isbn13, isbn10 } = isbns(r["ISBN13"], r["ISBN"]);
    const bookId = (r["Book Id"] ?? "").replace(/\D/g, "").slice(0, 30) || null;
    const exclusive = (r["Exclusive Shelf"] ?? "").trim().toLowerCase();
    const shelves = [
      exclusive,
      ...(r["Bookshelves"] ?? "").split(",").map((s) => s.trim().toLowerCase()),
    ]
      .filter(Boolean)
      .filter((s, i, all) => all.indexOf(s) === i)
      .slice(0, 50)
      .map((s) => s.slice(0, 100));
    const myRating = Number((r["My Rating"] ?? "").trim());
    const rating = halfStar(Number.isFinite(myRating) ? myRating : null);
    const reviewHtml = review(r["My Review"]);
    const pages = int(r["Number of Pages"], { min: 1 });
    const readCount = int(r["Read Count"], { max: 1000 }) ?? 0;
    const finished = day(r["Date Read"]);
    const started = has("Date Started") ? day(r["Date Started"]) : null;
    const warnings: string[] = [];
    const identity = { bookId, isbn13, title, firstAuthor: author };
    const key = (n: number) => goodreadsReadingKey(identity, n);
    const row: ImportRow = {
      kind: "readings",
      sourceBookId: bookId,
      title,
      authors: [author, ...additional].filter(Boolean),
      isbn13,
      isbn10,
      fileRating: rating,
      rating,
      reviewHtml,
      shelves,
      privateNotes: text(r["Private Notes"], 20_000),
      pages,
      extras: {},
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
    if (exclusive === "to-read") {
      row.kind = "to_read";
      return row;
    }
    const abandoned = shelves.some((s) => ABANDON_SHELVES.includes(s));
    const paused = !abandoned && shelves.some((s) => PAUSE_SHELVES.includes(s));
    const reading = !abandoned && !paused && exclusive === "currently-reading";
    const latest = (n: number, status: ReadingStatus): ImportReading => ({
      ...base(n, status),
      startedOn: started,
      startedPrecision: started ? "day" : "unknown",
      finishedOn: status === "finished" || status === "abandoned" ? finished : null,
      finishedPrecision: (status === "finished" || status === "abandoned") && finished ? "day" : "unknown",
      rating: status === "finished" ? rating : null,
      reviewHtml,
      sourceKey: key(n),
    });
    const earlier = (count: number) =>
      Array.from({ length: count }, (_, i): ImportReading => ({
        ...base(i + 1, "finished"),
        sourceKey: key(i + 1),
        note: "Earlier read, date unknown",
      }));
    if (reading || paused) {
      // The earlier reads, the last one dated when Goodreads kept a date
      const reads = readCount;
      const before = earlier(Math.max(0, reads - (finished ? 1 : 0)));
      const dated = reads > 0 && finished ? [{ ...latest(reads, "finished"), startedOn: null, startedPrecision: "unknown" as const, reviewHtml: null }] : [];
      const open = latest(reads + 1, reading ? "reading" : "paused");
      row.readings = [...before, ...dated, open];
    } else if (abandoned) {
      const reads = Math.max(1, readCount);
      row.readings = [...earlier(reads - 1), { ...latest(reads, "abandoned"), rating: null }];
      if (reads > 1) warnings.push("Goodreads keeps only the last read date");
    } else if (exclusive === "read" || readCount > 0 || finished) {
      const reads = Math.max(1, readCount);
      row.readings = [...earlier(reads - 1), latest(reads, "finished")];
      if (reads > 1) warnings.push("Goodreads keeps only the last read date");
    } else {
      // A custom exclusive shelf with no read: kept, not imported
      row.kind = "to_read";
      return row;
    }
    // The date rule: a finish before its start cannot be imported
    for (const r of row.readings) {
      const error = datesError(r);
      if (error) row.error = error;
    }
    // The rating the import proposes: the one a reading carries (the latest finished read)
    row.rating = row.readings.find((x) => x.rating !== null)?.rating ?? null;
    return row;
  });
  return { source: "goodreads", rows, missing };
}
