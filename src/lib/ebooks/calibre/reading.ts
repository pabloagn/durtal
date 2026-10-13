import { sql } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { resultRows } from "@/lib/harmonization/store";
import { ebookLibraryReadingKey } from "@/lib/reading/source-keys";
import type { ImportReading, ImportRow } from "@/lib/reading/import/types";
import { appTimeZone, calendarDate } from "@/lib/utils/date";
import type { CalibreBook, CalibreColumn, CalibreSnapshot } from "./library";

/*
 * Calibre's ratings and read dates as a reading import (SLN-658): one row for
 * each Calibre book that is a linked e-book in Durtal and has a rating or a
 * read. The rating is Calibre's own; whether a book was read, and when, live
 * in custom columns that differ from one library to the next, so they are
 * named. The rows go through the reading import's own preview, where every
 * conflict shows and nothing is written until Joris commits.
 */

export interface CalibreReadColumns {
  /** A yes/no column: the book was read */
  read?: string | null;
  /** A date column: when it was read */
  readDate?: string | null;
}

/** A Calibre book that is a linked e-book in Durtal: its book, edition and digital copy */
export interface LinkedCalibreBook {
  uuid: string;
  workId: string;
  editionId: string;
  instanceId: string;
}

/** The columns named, as the snapshot has them; a name it lacks, or of another kind, is refused */
export function requireReadColumns(snapshot: CalibreSnapshot, names: CalibreReadColumns, nothing = "Nothing created.") {
  const find = (name: string | null | undefined, type: "bool" | "datetime", what: string): CalibreColumn | null => {
    if (!name) return null;
    const label = name.trim().replace(/^#/, "");
    const column = snapshot.columns.find((c) => c.label === label);
    if (!column) {
      const fitting = snapshot.columns.filter((c) => c.type === type).map((c) => `#${c.label}`);
      throw new Error(`The column #${label} is not in the snapshot${fitting.length ? `: its ${what} columns are ${fitting.join(", ")}` : `, which has no ${what} column`}. ${nothing}`);
    }
    if (column.type !== type) throw new Error(`The column #${label} holds ${column.type} values, not ${what} ones. ${nothing}`);
    return column;
  };
  const read = find(names.read, "bool", "yes/no");
  const readDate = find(names.readDate, "datetime", "date");
  if (!read && !readDate) throw new Error(`Name the column that says a book was read (--read-column), the one with its date (--read-date-column), or both. ${nothing}`);
  return { read, readDate };
}

const firstIsbn = (book: CalibreBook) => {
  const isbn = book.identifiers.find((i) => i.type.toLowerCase() === "isbn")?.value.replace(/[^0-9Xx]/g, "") ?? "";
  return { isbn13: isbn.length === 13 ? isbn : null, isbn10: isbn.length === 10 ? isbn.toUpperCase() : null };
};

/**
 * The rows of a Calibre reading import, in the snapshot's order, numbered by
 * Calibre's book id. A read's date is the calendar date in `timeZone`: Calibre
 * keeps a date column as a UTC time.
 */
export function calibreReadingRows(
  snapshot: CalibreSnapshot,
  linked: LinkedCalibreBook[],
  names: CalibreReadColumns,
  timeZone = appTimeZone(),
): { rows: ImportRow[]; rowNos: number[] } {
  const columns = requireReadColumns(snapshot, names);
  const links = new Map(linked.map((l) => [l.uuid.toLowerCase(), l]));
  const rows: ImportRow[] = [];
  const rowNos: number[] = [];
  for (const book of snapshot.books) {
    const link = links.get(book.uuid.toLowerCase());
    if (!link) continue;
    const flag = columns.read ? book.custom[columns.read.label] : undefined;
    const when = columns.readDate ? book.custom[columns.readDate.label] : undefined;
    const date = typeof when === "string" ? calendarDate(new Date(when), timeZone) : null;
    const warnings: string[] = [];
    // A read: the column says so, or there is a date and the column does not say otherwise
    const read = flag === true || (date !== null && flag !== false);
    // The two columns disagree: shown, never guessed; with no rating the row has nothing else to import
    const disagree = date && flag === false ? `The library has a read date (${date}) but says the book was not read: no read is imported` : null;
    if (disagree && book.rating !== null) warnings.push(disagree);
    if (!read && book.rating === null && !disagree) continue;
    const readings: ImportReading[] = read
      ? [
          {
            n: 1,
            status: "finished",
            startedOn: null,
            startedPrecision: "unknown",
            finishedOn: date,
            finishedPrecision: date ? "day" : "unknown",
            format: "ebook",
            unit: "percent",
            totalPages: null,
            totalMinutes: null,
            position: null,
            // The book's rating is the row's, settled on its own
            rating: null,
            reviewHtml: null,
            abandonReason: null,
            abandonNote: null,
            readingId: null,
            sourceKey: ebookLibraryReadingKey({ libraryId: snapshot.library.id, bookId: book.uuid }),
            ...(date ? {} : { note: "Read, date unknown" }),
          },
        ]
      : [];
    rows.push({
      kind: "readings",
      sourceBookId: null,
      title: book.title,
      authors: book.authors.map((a) => a.name),
      ...firstIsbn(book),
      fileRating: book.rating,
      rating: book.rating,
      reviewHtml: null,
      shelves: [],
      privateNotes: null,
      pages: null,
      extras: {},
      workId: link.workId,
      editionId: link.editionId,
      instanceId: link.instanceId,
      readings,
      warnings,
      error: disagree && book.rating === null ? disagree : null,
    });
    rowNos.push(book.id);
  }
  return { rows, rowNos };
}

/** The linked e-books Durtal holds from this Calibre library, by Calibre uuid */
export async function linkedCalibreBooks(database: Db, libraryId: string): Promise<LinkedCalibreBook[]> {
  return resultRows<LinkedCalibreBook>(
    await database.execute(sql`
      select distinct on (lower(e.import_ref)) lower(e.import_ref) as uuid, ed.work_id::text as "workId",
        ed.id::text as "editionId", i.id::text as "instanceId"
      from ebooks e
      join instances i on i.id = e.instance_id
      join editions ed on ed.id = i.edition_id
      join works w on w.id = ed.work_id and w.kind = 'book'
      where e.match_state = 'linked' and e.import_source = 'folder' and e.import_ref is not null
        and exists (select 1 from ebook_files f where f.ebook_id = e.id and f.metadata->'calibre'->>'libraryId' = ${libraryId})
      order by lower(e.import_ref), e.created_at, e.id`),
  );
}
