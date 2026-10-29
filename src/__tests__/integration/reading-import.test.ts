import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import * as atomicModule from "@/lib/db/atomic";
import { toCSV } from "@/lib/utils/export";
import { SESSION_EXPORT_COLUMNS, SESSION_EXPORT_COLUMNS_V2 } from "@/lib/export/columns";
import { renderThought } from "@/lib/reading/import/thought";
import { countedPagesSql } from "@/lib/reading/summary";
import { parseImportFile } from "@/lib/reading/import/parse";
import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as schema from "@/lib/db/schema";
import { GOODREADS_EXPORT_HEADER } from "@/lib/reading/import/formats";
import { DURTAL_READING_COLUMNS } from "@/lib/reading/import/durtal-format";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_READING_IMPORT_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln450_reading_import");
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln450_reading_import")
    throw new Error("Reading import tests require a disposable local sln450_reading_import database");
}
const client = url ? postgres(url, { prepare: false, max: 6, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
const executed = { count: 0 };
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, prop) => {
        if (!testDb) throw new Error("Local test database required");
        if (prop === "execute") {
          return (...args: unknown[]) => {
            executed.count++;
            return (testDb.execute as (...a: unknown[]) => unknown)(...args);
          };
        }
        return Reflect.get(testDb, prop);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({
  cached: (fn: unknown) => fn,
  invalidate: vi.fn(),
  CACHE_TAGS: new Proxy({}, { get: (_, prop) => String(prop) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/s3/covers", () => ({ uploadToS3: vi.fn(), getS3Object: vi.fn(), deleteFromS3: vi.fn() }));
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: vi.fn(async () => false),
}));
vi.mock("@/lib/reading/service", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/reading/service")>();
  return { ...real, writeReadings: vi.fn(real.writeReadings) };
});
import { chooseBook, createLibraryReadingImport, createReadingImport } from "@/lib/reading/import/store";
import { getImportPreview, listReadingImports } from "@/lib/reading/import/page-data";
import { commitReadingImport, decideImportRow, decideImportSection, rematchImport, undoReadingImport } from "@/lib/actions/reading-import";
import { writeReadings } from "@/lib/reading/service";
import { ExpectedActionError } from "@/lib/actions/expected-error";
import { updateEdition } from "@/lib/actions/editions";
import { canCommitImport, canUndoImport } from "@/lib/reading/import/action-words";
import { registerCatalogueIdentifier, recordSourceObservation } from "@/lib/actions/catalogue-provenance";
import { claimImportedGoodreadsIds } from "@/lib/catalogue/goodreads-identity";
import type { StoredRow } from "@/lib/reading/import/store";
import { NextRequest } from "next/server";
import { POST as exportRoute } from "@/app/api/export/route";
import { parseCsv } from "@/lib/reading/import/csv";
import { executeMerge, previewMerge } from "@/lib/harmonization/merge";
import { deleteWork } from "@/lib/actions/works";
import type { ImportMatch } from "@/lib/reading/import/match-rules";
import type { ImportRow } from "@/lib/reading/import/types";
import type { Written } from "@/lib/reading/import/store";
import { commitWords } from "@/lib/reading/import/preview-text";

/* The reading import against PostgreSQL (SLN-450): matching, the duplicate
   verdicts, decisions, commit, undo and the table's rules. Every file is
   synthetic, written here. */

describe.skipIf(!url)("the reading import with PostgreSQL", () => {
  const q = (text: string, params: unknown[] = []) => client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, params: unknown[] = []) => Object.values((await q(text, params))[0] ?? {})[0] as T;

  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln450_reading_import");
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await resetDisposableDatabase(url!, "sln450_reading_import", { emptyLocations: true });
    vi.mocked(writeReadings).mockReset();
  }, 30000);

  let serial = 0;
  async function book(title: string, author: string, over: { goodreadsUrl?: string; rating?: number; kind?: string } = {}) {
    const workId = await value(`insert into works(title, slug, goodreads_url, rating, kind, original_language) values ($1, $2, $3, $4, $5::work_kind_enum, case when $5::text = 'book' then 'en' end) returning id`, [
      title,
      `${title.toLowerCase().replace(/\W+/g, "-")}-${++serial}`,
      over.goodreadsUrl ?? null,
      over.rating ?? null,
      over.kind ?? "book",
    ]);
    if (over.kind && over.kind !== "book") return workId;
    const authorId =
      (await value(`select id from authors where name = $1`, [author])) ??
      (await value(`insert into authors(name, slug) values ($1, $2) returning id`, [author, `${author.toLowerCase().replace(/\W+/g, "-")}-${serial}`]));
    await q(`insert into work_authors(work_id, author_id, role) values ($1, $2, 'author')`, [workId, authorId]);
    return workId;
  }
  async function edition(workId: string, over: { title?: string; isbn13?: string; isbn10?: string; goodreadsId?: string; pages?: number } = {}) {
    return value(`insert into editions(work_id, title, language, isbn_13, isbn_10, goodreads_id, page_count) values ($1, $2, 'en', $3, $4, $5, $6) returning id`, [
      workId,
      over.title ?? (await value(`select title from works where id = $1`, [workId])),
      over.isbn13 ?? null,
      over.isbn10 ?? null,
      over.goodreadsId ?? null,
      over.pages ?? null,
    ]);
  }
  async function reading(workId: string, over: Record<string, unknown>) {
    const [r] = await writeReadings([{ workId, format: "print", startedPrecision: "unknown", finishedPrecision: "unknown", status: "finished", ...over } as never], { source: "manual" });
    expect(r.outcome).toBe("written");
    return r.readingId!;
  }

  /** A Goodreads export with the full header */
  function goodreads(rows: Record<string, string>[]) {
    const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    return [GOODREADS_EXPORT_HEADER.join(","), ...rows.map((r) => GOODREADS_EXPORT_HEADER.map((h) => cell(r[h] ?? "")).join(","))].join("\n");
  }
  function durtal(rows: Record<string, string>[]) {
    return [DURTAL_READING_COLUMNS.join(","), ...rows.map((r) => DURTAL_READING_COLUMNS.map((h) => r[h] ?? "").join(","))].join("\n");
  }
  const upload = (text: string, fileName = "goodreads_library_export.csv") => createReadingImport({ text, fileName });
  async function rows(importId: string) {
    return (await q(`select row_no, data, match, decision, work_id, written, use_file_rating from reading_import_rows where import_id = $1 order by row_no`, [importId])).map((r) => ({
      rowNo: r.row_no as number,
      data: r.data as { title: string },
      match: r.match as ImportMatch,
      decision: r.decision as string,
      workId: r.work_id as string | null,
      written: r.written as Written | null,
      useFileRating: r.use_file_rating as boolean,
    }));
  }
  const readingsOf = async (workId: string) =>
    q(`select id, status, source, source_key, import_id, finished_on::text as finished_on, finished_precision, rating::float8 as rating, total_pages from readings where work_id = $1 order by finished_on nulls first, source_key`, [workId]);

  describe("matching", () => {
    it("finds each exact reason", async () => {
      const byGid = await book("Crime and Punishment", "Fyodor Dostoevsky");
      const gidEdition = await edition(byGid, { goodreadsId: "7144" });
      const byIdentifier = await book("Nadja", "André Breton");
      await q(`insert into catalogue_identifiers(entity_kind, work_id, provider, external_id) values ('book', $1, 'goodreads', '1001')`, [byIdentifier]);
      const byEditionIdentifier = await book("Arcane 17", "André Breton");
      const arcane = await edition(byEditionIdentifier);
      await q(`insert into catalogue_identifiers(entity_kind, edition_id, provider, external_id) values ('edition', $1, 'goodreads', '1002')`, [arcane]);
      const byLink = await book("Là-bas", "J.-K. Huysmans", { goodreadsUrl: "https://www.goodreads.com/book/show/42.La_bas" });
      const byIsbn13 = await book("Watt", "Samuel Beckett");
      const wattEdition = await edition(byIsbn13, { isbn13: "9780140449136" });
      const byIsbn10 = await book("Molloy", "Samuel Beckett");
      const molloyEdition = await edition(byIsbn10, { isbn10: "2070360245" });
      const { importId } = await upload(
        goodreads([
          { "Book Id": "7144", Title: "Crime and Punishment", Author: "Fyodor Dostoevsky", "Exclusive Shelf": "read", "Read Count": "1" },
          { "Book Id": "1001", Title: "Nadja", Author: "André Breton", "Exclusive Shelf": "read", "Read Count": "1" },
          { "Book Id": "1002", Title: "Arcane 17", Author: "André Breton", "Exclusive Shelf": "read", "Read Count": "1" },
          { "Book Id": "42", Title: "Down There", Author: "J.-K. Huysmans", "Exclusive Shelf": "read", "Read Count": "1" },
          { "Book Id": "9", Title: "Something else", Author: "Nobody", ISBN13: '="9780140449136"', "Exclusive Shelf": "read", "Read Count": "1" },
          { "Book Id": "10", Title: "Another", Author: "Nobody", ISBN: '="2070360245"', "Exclusive Shelf": "read", "Read Count": "1" },
        ]),
      );
      const r = await rows(importId);
      expect(r.map((x) => [x.workId, x.match.found, x.match.reason, x.match.editionId, x.decision])).toEqual([
        [byGid, "exact", "Same Goodreads id", gidEdition, "import"],
        [byIdentifier, "exact", "Same Goodreads id", null, "import"],
        [byEditionIdentifier, "exact", "Same Goodreads id", arcane, "import"],
        [byLink, "exact", "Same Goodreads link", null, "import"],
        [byIsbn13, "exact", "Same ISBN", wattEdition, "import"],
        [byIsbn10, "exact", "Same ISBN", molloyEdition, "import"],
      ]);
    });

    it("matches a Durtal file's work id, and refuses an edition of another book", async () => {
      const workId = await book("Watt", "Samuel Beckett");
      const own = await edition(workId);
      const other = await edition(await book("Molloy", "Samuel Beckett"));
      const { importId } = await upload(
        durtal([
          { work_id: workId, edition_id: own, title: "Watt", authors: "Samuel Beckett", status: "finished" },
          { work_id: workId, edition_id: other, title: "Watt", authors: "Samuel Beckett", status: "finished", finished_on: "2020-01-01", finished_precision: "year" },
        ]),
        "readings.csv",
      );
      const [a, b] = await rows(importId);
      expect([a.match.reason, a.match.editionId, a.match.warnings]).toEqual(["Exact Durtal parent", own, []]);
      expect(b.match).toMatchObject({section:"cannot",note:"The explicit edition is missing or belongs to another book"});
    });

    it("finds likely, possible and no matches, and a book by its English edition title", async () => {
      const assommoir = await book("L'Assommoir", "Émile Zola");
      await edition(assommoir, { title: "The Drinking Den" });
      const watt = await book("Watt", "Samuel Beckett");
      await book("Murphy", "Samuel Beckett");
      await book("Murphy's Law", "Samuel Becket Jr");
      const { importId } = await upload(
        goodreads([
          { Title: "The Drinking Den (Les Rougon-Macquart, #7)", Author: "Emile Zola", "Exclusive Shelf": "read" },
          { Title: "Watt: A Novel", Author: "Samuel Beckett", "Exclusive Shelf": "read" },
          { Title: "Murphy", Author: "S. Beckett", "Exclusive Shelf": "read" },
          { Title: "Murphy", Author: "Someone Else", "Exclusive Shelf": "read" },
          { Title: "The Recognitions", Author: "William Gaddis", "Exclusive Shelf": "read" },
        ]),
      );
      const [den, wattRow, murphy, otherMurphy, gaddis] = await rows(importId);
      expect([den.workId, den.match.found, den.match.reason]).toEqual([assommoir, "likely", "Title and author, 100%"]);
      expect([wattRow.workId, wattRow.match.found, wattRow.decision]).toEqual([watt, "likely", "pending"]);
      expect(murphy.match.found).toBe("likely");
      expect([otherMurphy.workId, otherMurphy.match.found, otherMurphy.match.section]).toEqual([null, "possible", "choose"]);
      expect(otherMurphy.match.candidates[0]).toMatchObject({ score: 1, byAuthor: false });
      expect([gaddis.match.found, gaddis.match.section, gaddis.decision]).toEqual(["none", "none", "pending"]);
    });

    it("imports a StoryGraph file: a read per range, the rating rounded, the format", async () => {
      const workId = await book("Crime and Punishment", "Fyodor Dostoevsky");
      await edition(workId, { isbn13: "9780140449136" });
      const text = readFileSync(join(__dirname, "../fixtures/reading-import/storygraph.csv"), "utf8");
      const { importId, source } = await upload(text, "storygraph.csv");
      expect(source).toBe("storygraph");
      const all = await rows(importId);
      const row = all.find((x) => x.data.title === "Crime and Punishment")!;
      expect([row.workId, row.match.reason, row.decision]).toEqual([workId, "Same ISBN", "import"]);
      // His answers stay in the row for the enrichment epic (SLN-463's check)
      expect((row.data as { extras?: unknown }).extras).toEqual({ Moods: "dark, reflective", Pace: "medium", Tags: "russian" });
      expect(all.find((x) => x.data.title === "Backwards")!.match.section).toBe("cannot");
      expect(await commitReadingImport({ importId })).toMatchObject({ written: 2 });
      const written = await q(`select started_on::text as s, finished_on::text as f, rating::float8 as rating, format, source from readings where work_id = $1 order by finished_on`, [workId]);
      expect(written.map((r) => [r.s, r.f, r.rating, r.format, r.source])).toEqual([
        ["2021-03-01", "2021-04-02", null, "print", "import"],
        ["2023-01-05", "2023-02-10", 4, "print", "import"],
      ]);
    });

    it("matches a 2,000-row file with one query per batch", async () => {
      for (let i = 0; i < 20; i++) await edition(await book(`Book ${i}`, `Author ${i}`), { isbn13: null as never });
      const many = Array.from({ length: 2000 }, (_, i) => ({ "Book Id": String(100_000 + i), Title: `Title number ${i}`, Author: `Writer ${i % 50}`, "Exclusive Shelf": "read", "Read Count": "1", "Date Read": "2020/01/01" }));
      executed.count = 0;
      const started = performance.now();
      const { rows: n } = await upload(goodreads(many));
      const ms = performance.now() - started;
      expect(n).toBe(2000);
      // Ids, Goodreads ids (2 batches), ISBNs, titles (2 batches), readings: a handful, never one per row
      expect(executed.count).toBeLessThan(15);
      expect(ms).toBeLessThan(10_000);
      console.info(`[sln450] 2,000 rows parsed, matched and stored in ${Math.round(ms)} ms with ${executed.count} queries`);
    }, 60_000);
  });

  describe("already in Durtal", () => {
    it("agrees at the coarser precision: a month or a year against a day", async () => {
      const month = await book("Watt", "Samuel Beckett");
      await edition(month, { goodreadsId: "1" });
      await reading(month, { finishedOn: "2019-04-01", finishedPrecision: "month" });
      const year = await book("Molloy", "Samuel Beckett");
      await edition(year, { goodreadsId: "2" });
      await reading(year, { finishedOn: "2019-01-01", finishedPrecision: "year" });
      const { importId } = await upload(
        goodreads([
          { "Book Id": "1", Title: "Watt", Author: "Samuel Beckett", "Exclusive Shelf": "read", "Read Count": "1", "Date Read": "2019/04/14" },
          { "Book Id": "2", Title: "Molloy", Author: "Samuel Beckett", "Exclusive Shelf": "read", "Read Count": "1", "Date Read": "2019/11/30" },
        ]),
      );
      for (const r of await rows(importId)) {
        expect(r.match.section).toBe("present");
        expect(r.match.verdicts.map((v) => v.reason)).toEqual(["Same finish date"]);
        expect(r.decision).toBe("skip");
      }
    });

    it("counts undated reads: Read Count 3 against one dated and one undated read creates one", async () => {
      const workId = await book("Watt", "Samuel Beckett");
      await edition(workId, { goodreadsId: "1" });
      await reading(workId, { finishedOn: "2019-04-14", finishedPrecision: "day" });
      await reading(workId, { finishedOn: "2015-01-01", finishedPrecision: "year" });
      const file = goodreads([{ "Book Id": "1", Title: "Watt", Author: "Samuel Beckett", "Exclusive Shelf": "read", "Read Count": "3", "Date Read": "2019/04/14" }]);
      const { importId } = await upload(file);
      const [r] = await rows(importId);
      expect(r.match.section).toBe("exact");
      expect(r.match.verdicts.map((v) => [v.n, v.verdict, v.reason])).toEqual([
        [1, "already_present", "Undated read"],
        [2, "new", null],
        [3, "already_present", "Same finish date"],
      ]);
      expect(await commitReadingImport({ importId })).toMatchObject({ written: 1, present: 2 });
      expect((await readingsOf(workId)).length).toBe(3);
      // The same file again creates nothing
      const again = await upload(file);
      const [r2] = await rows(again.importId);
      expect(r2.match.section).toBe("present");
      expect(await commitReadingImport({ importId: again.importId })).toMatchObject({ written: 0 });
      expect((await readingsOf(workId)).length).toBe(3);
    });

    it("offers Import anyway for a row present only through the undated count", async () => {
      const workId = await book("Watt", "Samuel Beckett");
      await edition(workId, { goodreadsId: "1" });
      await reading(workId, {});
      const { importId } = await upload(goodreads([{ "Book Id": "1", Title: "Watt", Author: "Samuel Beckett", "Exclusive Shelf": "read", "Read Count": "1" }]));
      const [r] = await rows(importId);
      expect([r.match.section, r.match.note, r.decision]).toEqual(["present", "Undated read", "skip"]);
      await decideImportRow({ importId, rowNo: 1, decision: "import" });
      expect(await commitReadingImport({ importId })).toMatchObject({ written: 1 });
      expect((await readingsOf(workId)).length).toBe(2);
    });

    it("handles open reads: the same reading, a book already being read, another open reading named", async () => {
      const workId = await book("Watt", "Samuel Beckett");
      await edition(workId, { goodreadsId: "1" });
      const open = await reading(workId, { status: "reading" });
      const { importId } = await upload(
        durtal([
          { reading_id: open, work_id: workId, title: "Watt", status: "reading" },
          { reading_id: "99999999-9999-4999-8999-999999999999", work_id: workId, title: "Watt", status: "paused" },
        ]),
        "readings.csv",
      );
      const [same, other] = await rows(importId);
      expect([same.match.section, same.match.note]).toEqual(["present", "Already in Durtal; existing edits kept"]);
      expect([other.match.section, other.match.note, other.decision]).toEqual(["cannot", "This book already has an open reading", "skip"]);
      const gr = await upload(goodreads([{ "Book Id": "1", Title: "Watt", Author: "Samuel Beckett", "Exclusive Shelf": "currently-reading", "Read Count": "0" }]));
      const [current] = await rows(gr.importId);
      expect([current.match.section, current.match.verdicts[0].reason, current.match.verdicts[0].readingId]).toEqual(["present", "Already open in Durtal", open]);
    });
  });

  describe("decisions", () => {
    it("saves each decision as one row's update, kept on reload; bulk actions cover a section", async () => {
      await book("Watt", "Samuel Beckett");
      await book("Molloy", "Samuel Beckett");
      const { importId } = await upload(
        goodreads([
          { Title: "Watt", Author: "Samuel Beckett", "Exclusive Shelf": "read" },
          { Title: "Molloy", Author: "Samuel Beckett", "Exclusive Shelf": "read" },
          { Title: "Unknown One", Author: "Nobody", "Exclusive Shelf": "read" },
          { Title: "Unknown Two", Author: "Nobody", "Exclusive Shelf": "read" },
        ]),
      );
      await decideImportRow({ importId, rowNo: 1, decision: "skip" });
      expect((await rows(importId)).map((r) => r.decision)).toEqual(["skip", "pending", "pending", "pending"]);
      expect(await decideImportSection({ importId, section: "likely", decision: "import" })).toEqual({ changed: 1 });
      expect(await decideImportSection({ importId, section: "none", decision: "skip" })).toEqual({ changed: 2 });
      expect((await rows(importId)).map((r) => r.decision)).toEqual(["skip", "import", "skip", "skip"]);
      await expect(decideImportRow({ importId, rowNo: 3, decision: "import" })).rejects.toThrow("Choose a book first");
    });

    it("chooses a book with the picker, and matches again after the book was added", async () => {
      const watt = await book("Watt", "Samuel Beckett");
      const { importId } = await upload(
        goodreads([
          { Title: "Some Watt", Author: "Unknown", "Exclusive Shelf": "read", "Date Read": "2020/02/02" },
          { Title: "The Recognitions", Author: "William Gaddis", ISBN13: '="9780140449136"', "Exclusive Shelf": "read" },
        ]),
      );
      await decideImportRow({ importId, rowNo: 1, workId: watt });
      const [chosen, missing] = await rows(importId);
      expect([chosen.workId, chosen.match.chosen, chosen.decision, chosen.match.verdicts.map((v) => v.verdict)]).toEqual([watt, true, "import", ["new"]]);
      expect(missing.match.section).toBe("none");
      const gaddis = await book("The Recognitions", "William Gaddis");
      await edition(gaddis, { isbn13: "9780140449136" });
      expect(await rematchImport({ importId })).toEqual({ matched: 1 });
      const [, found] = await rows(importId);
      expect([found.workId, found.match.found, found.match.reason, found.match.section, found.decision]).toEqual([gaddis, "exact", "Same ISBN", "exact", "import"]);
      // Once imported, the same file finds the chosen book by the reading's key
      await commitReadingImport({ importId });
      const again = await upload(
        goodreads([
          { Title: "Some Watt", Author: "Unknown", "Exclusive Shelf": "read", "Date Read": "2020/02/02" },
          { Title: "The Recognitions", Author: "William Gaddis", ISBN13: '="9780140449136"', "Exclusive Shelf": "read" },
        ]),
      );
      expect((await rows(again.importId)).map((r) => [r.workId, r.match.reason, r.match.section])).toEqual([
        [watt, "Same source", "present"],
        [gaddis, "Same source", "present"],
      ]);
    });
  });

  describe("commit and undo", () => {
    it("writes readings, history and written; a second commit and a second upload write nothing", async () => {
      const workId = await book("Watt", "Samuel Beckett");
      await edition(workId, { goodreadsId: "1", pages: 280 });
      const file = goodreads([
        { "Book Id": "1", Title: "Watt", Author: "Samuel Beckett", "My Rating": "4", "My Review": "<b>Good</b>", "Exclusive Shelf": "read", "Read Count": "2", "Date Read": "2019/04/14", "Number of Pages": "300" },
      ]);
      const { importId } = await upload(file);
      expect(await commitReadingImport({ importId })).toEqual({ identifiers: 0, written: 2, present: 0, refused: 0, rows: 1, queued: 0, queuePresent: 0, queueSkipped: 0, notes: 0, notesPresent: 0 });
      const written = await readingsOf(workId);
      expect(written.map((r) => [r.source, r.source_key, r.import_id, r.finished_on, r.rating, r.total_pages])).toEqual([
        ["import", "goodreads:1#1", importId, null, null, 280],
        ["import", "goodreads:1#2", importId, "2019-04-14", 4, 280],
      ]);
      expect(Number(await value(`select count(*) from reading_status_history h join readings r on r.id = h.reading_id where r.import_id = $1`, [importId]))).toBe(2);
      const [row] = await rows(importId);
      expect(row.written!.readings.map((r) => r.outcome)).toEqual(["written", "written"]);
      expect(row.written!.bookRating).toEqual({ workId, before: null, after: 4 });
      expect(await value(`select rating::float8 from works where id = $1`, [workId])).toBe(4);
      expect(await value(`select status from imports where id = $1`, [importId])).toBe("completed");
      expect(await commitReadingImport({ importId })).toEqual({ identifiers: 0, written: 0, present: 0, refused: 0, rows: 0, queued: 0, queuePresent: 0, queueSkipped: 0, notes: 0, notesPresent: 0 });
      const again = await upload(file);
      expect((await rows(again.importId)).map((r) => r.match.section)).toEqual(["present"]);
      expect(await commitReadingImport({ importId: again.importId })).toMatchObject({ written: 0 });
      expect((await readingsOf(workId)).length).toBe(2);
    });

    it("finishes a commit whose second chunk failed when it is run again", async () => {
      const lines = [];
      for (let i = 0; i < 60; i++) {
        const workId = await book(`Book ${i}`, "Samuel Beckett");
        await edition(workId, { goodreadsId: String(i + 1) });
        lines.push({ "Book Id": String(i + 1), Title: `Book ${i}`, Author: "Samuel Beckett", "Exclusive Shelf": "read", "Read Count": "2", "Date Read": "2020/01/01" });
      }
      const { importId } = await upload(goodreads(lines));
      const real = vi.mocked(writeReadings).getMockImplementation()!;
      vi.mocked(writeReadings).mockImplementationOnce(real).mockImplementationOnce(async () => {
        throw new Error("The connection dropped");
      });
      // What went in stays in, and the person is told so (SLN-1168)
      await expect(commitReadingImport({ importId })).rejects.toThrow(
        new ExpectedActionError("The import stopped partway: 100 readings are in. Import again to add the rest."),
      );
      const half = Number(await value(`select count(*) from readings where import_id = $1`, [importId]));
      expect(half).toBe(100);
      expect(await commitReadingImport({ importId })).toMatchObject({ written: 20 });
      expect(Number(await value(`select count(*) from readings where import_id = $1`, [importId]))).toBe(120);
      expect((await rows(importId)).every((r) => r.written)).toBe(true);
    });

    it.each([false, true])("restores the rating after a committed write loses its response (retry: %s)", async (retry) => {
      const workId = await book("Murphy", "Samuel Beckett", { rating: 2 });
      await edition(workId, { goodreadsId: "70001" });
      const { importId } = await upload(goodreads([
        { "Book Id": "70001", Title: "Murphy", Author: "Samuel Beckett", "My Rating": "5", "Exclusive Shelf": "read", "Read Count": "1" },
      ]));
      await decideImportRow({ importId, rowNo: 1, useFileRating: true });
      const real = vi.mocked(writeReadings).getMockImplementation()!;
      vi.mocked(writeReadings).mockImplementationOnce(async (...args) => {
        await real(...args);
        throw new Error("Lost response after committed readings");
      });
      await expect(commitReadingImport({ importId })).rejects.toThrow("Lost response");
      expect(await value(`select rating::float8 from works where id = $1`, [workId])).toBe(5);
      await expect(decideImportRow({ importId, rowNo: 1, useFileRating: false })).rejects.toThrow("undo the import");
      const otherWork = await book("Watt", "Samuel Beckett");
      await expect(chooseBook({ importId, rowNo: 1, workId: otherWork })).rejects.toThrow("undo the import");
      if (retry) await commitReadingImport({ importId });
      await undoReadingImport({ importId });
      expect(await value(`select rating::float8 from works where id = $1`, [workId])).toBe(2);
      expect(await readingsOf(workId)).toEqual([]);
    });

    it("rolls back readings and ratings if their durable undo journal cannot be saved", async () => {
      const workId = await book("Murphy", "Samuel Beckett", { rating: 2 });
      await edition(workId, { goodreadsId: "70002" });
      const { importId } = await upload(goodreads([
        { "Book Id": "70002", Title: "Murphy", Author: "Samuel Beckett", "My Rating": "5", "Exclusive Shelf": "read" },
      ]));
      await decideImportRow({ importId, rowNo: 1, useFileRating: true });
      await q(`create or replace function test_refuse_journal() returns trigger language plpgsql as $$ begin
        if new.written->'bookRating' is not null and new.written->'bookRating' <> 'null'::jsonb then
          raise exception 'Journal unavailable'; end if; return new; end $$`);
      await q(`create trigger test_refuse_journal before update on reading_import_rows for each row execute function test_refuse_journal()`);
      try {
        await expect(commitReadingImport({ importId })).rejects.toThrow();
        expect(await value(`select rating::float8 from works where id = $1`, [workId])).toBe(2);
        expect(await readingsOf(workId)).toEqual([]);
      } finally {
        await q(`drop trigger test_refuse_journal on reading_import_rows`);
        await q(`drop function test_refuse_journal()`);
      }
      await commitReadingImport({ importId });
      await undoReadingImport({ importId });
      expect(await value(`select rating::float8 from works where id = $1`, [workId])).toBe(2);
    });

    it("keeps identifier and rating undo records when the final row summary fails", async () => {
      const workId = await book("Murphy", "Samuel Beckett", { rating: 2 });
      await edition(workId, { isbn13: "9780140449136" });
      const { importId } = await upload(goodreads([
        { "Book Id": "70003", ISBN13: '="9780140449136"', Title: "Murphy", Author: "Samuel Beckett", "My Rating": "5", "Exclusive Shelf": "read" },
      ]));
      await decideImportRow({ importId, rowNo: 1, useFileRating: true });
      await q(`create or replace function test_refuse_summary() returns trigger language plpgsql as $$ begin
        if jsonb_array_length(coalesce(new.written->'readings', '[]'::jsonb)) > 0 then
          raise exception 'Summary unavailable'; end if; return new; end $$`);
      await q(`create trigger test_refuse_summary before update on reading_import_rows for each row execute function test_refuse_summary()`);
      try {
        await expect(commitReadingImport({ importId })).rejects.toThrow();
        expect(await value(`select rating::float8 from works where id = $1`, [workId])).toBe(5);
        expect(Number(await value(`select count(*) from catalogue_identifiers where external_id = '70003'`))).toBe(1);
      } finally {
        await q(`drop trigger test_refuse_summary on reading_import_rows`);
        await q(`drop function test_refuse_summary()`);
      }
      await commitReadingImport({ importId });
      await undoReadingImport({ importId });
      expect(await value(`select rating::float8 from works where id = $1`, [workId])).toBe(2);
      expect(Number(await value(`select count(*) from catalogue_identifiers where external_id = '70003'`))).toBe(0);
    });

    it("never changes a book rating silently, and undo restores it only while unchanged", async () => {
      const none = await book("Watt", "Samuel Beckett");
      await edition(none, { goodreadsId: "1" });
      const rated = await book("Molloy", "Samuel Beckett", { rating: 3 });
      await edition(rated, { goodreadsId: "2" });
      const replaced = await book("Murphy", "Samuel Beckett", { rating: 2 });
      await edition(replaced, { goodreadsId: "3" });
      const { importId } = await upload(
        goodreads([
          { "Book Id": "1", Title: "Watt", Author: "Samuel Beckett", "My Rating": "4", "Exclusive Shelf": "read", "Read Count": "1" },
          { "Book Id": "2", Title: "Molloy", Author: "Samuel Beckett", "My Rating": "4", "Exclusive Shelf": "read", "Read Count": "1" },
          { "Book Id": "3", Title: "Murphy", Author: "Samuel Beckett", "My Rating": "5", "Exclusive Shelf": "read", "Read Count": "1" },
        ]),
      );
      const preview = await getImportPreview(importId);
      expect(preview!.summary.ratingsDiffer).toBe(2);
      await decideImportRow({ importId, rowNo: 3, useFileRating: true });
      await commitReadingImport({ importId });
      const rating = (id: string) => value<number | null>(`select rating::float8 from works where id = $1`, [id]);
      expect([await rating(none), await rating(rated), await rating(replaced)]).toEqual([4, 3, 5]);
      // Changed by hand after the import: undo leaves it
      await q(`update works set rating = 4.5 where id = $1`, [none]);
      await undoReadingImport({ importId });
      expect([await rating(none), await rating(rated), await rating(replaced)]).toEqual([4.5, 3, 2]);
    });

    describe("Goodreads identity claims", () => {
      const line = (id: string, title = "Watt", extra: Record<string, string> = {}) =>
        ({ "Book Id": id, Title: title, Author: "Samuel Beckett", "Exclusive Shelf": "read", "Read Count": "1", ...extra });
      const accept = async (importId: string, rowNo = 1) => decideImportRow({ importId, rowNo, decision: "import" });
      const identityRows = () => q(`select id, entity_kind, work_id, edition_id, external_id from catalogue_identifiers where provider = 'goodreads'`);
      const exportIds = async () => {
        const response = await exportRoute(new NextRequest("http://localhost/api/export", { method: "POST", body: JSON.stringify({ entity: "goodreads", format: "csv", all: true }) }));
        expect(response.status).toBe(200);
        const [header, ...data] = parseCsv(await response.text());
        return { data: data.map((row) => Object.fromEntries(header.map((key, i) => [key, row[i]]))), warning: response.headers.get("X-Durtal-Goodreads-Unresolved") };
      };
      it("preserves a manual no-edition association and the literal large ID through export and Undo", async () => {
        const workId = await book("Watt", "Samuel Beckett");
        const id = "0009007199254740993";
        const { importId } = await upload(goodreads([line(id, "Different title")]));
        await chooseBook({ importId, rowNo: 1, workId });
        await accept(importId);
        await commitReadingImport({ importId });
        expect(await identityRows()).toEqual([expect.objectContaining({ entity_kind: "book", work_id: workId, edition_id: null, external_id: id })]);
        expect((await exportIds()).data[0]["Book Id"]).toBe(id);
        await undoReadingImport({ importId });
        expect(await identityRows()).toEqual([]);
      });
      it("reuses an existing same-book legacy identity without claiming Undo ownership", async () => {
        const workId = await book("Watt", "Samuel Beckett");
        const editionId = await edition(workId, { goodreadsId: "00072112" });
        const { importId } = await upload(goodreads([line("72112")]));
        expect((await getImportPreview(importId))!.summary.identifiers).toBe(0);
        expect(await commitReadingImport({ importId })).toMatchObject({ identifiers: 0 });
        expect((await rows(importId))[0].written?.identifiers).toEqual([]);
        expect(await identityRows()).toEqual([]);
        await undoReadingImport({ importId });
        expect(await value(`select goodreads_id from editions where id = $1`, [editionId])).toBe("00072112");
      });
      it("retains an edition-owned ID after the public edition action moves its effective book", async () => {
        const original = await book("Watt", "Samuel Beckett");
        const target = await book("Molloy", "Samuel Beckett");
        const editionId = await edition(original, { isbn13: "9780140449136" });
        const { importId } = await upload(goodreads([line("72113", "Watt", { ISBN13: "9780140449136" })]));
        // No reading exists to incidentally protect the ID: its effective owner snapshot is the guard.
        vi.mocked(writeReadings).mockRejectedValueOnce(new Error("First reading failed"));
        await expect(commitReadingImport({ importId })).rejects.toThrow("First reading failed");
        expect((await rows(importId))[0].written?.identifierSnapshots?.[0]).toMatchObject({ workId: null, editionId, effectiveWorkId: original });
        await updateEdition(editionId, { workId: target });
        expect(await value(`select work_id from editions where id = $1`, [editionId])).toBe(target);
        expect(await undoReadingImport({ importId })).toMatchObject({ removed: 0, identifiersKept: 1 });
        expect(await identityRows()).toEqual([expect.objectContaining({ edition_id: editionId, external_id: "72113" })]);
      });
      it.each([false, true])("exposes safe Undo for a failed first reading with a reused claim: %s", async (reused) => {
        const workId = await book("Watt", "Samuel Beckett");
        if (reused) await registerCatalogueIdentifier({ owner: { kind: "book", id: workId }, provider: "goodreads", externalId: "72114" });
        const { importId } = await upload(goodreads([line("72114")])); await accept(importId);
        vi.mocked(writeReadings).mockRejectedValueOnce(new Error("First reading failed"));
        await expect(commitReadingImport({ importId })).rejects.toThrow("First reading failed");
        const header = (await getImportPreview(importId))!.header;
        const listed = (await listReadingImports()).find((i) => i.id === importId)!;
        expect(header).toMatchObject({ readings: 0, queued: 0, notes: 0, ratings: 0, pendingClaims: 1, identifiers: reused ? 0 : 1 });
        expect(canUndoImport(header)).toBe(true);
        expect(canUndoImport(listed)).toBe(true);
        expect(await undoReadingImport({ importId })).toMatchObject({ removed: 0, queueRemoved: 0, notesRemoved: 0 });
        expect((await getImportPreview(importId))!.header.pendingClaims).toBe(0);
        expect(await identityRows()).toHaveLength(reused ? 1 : 0);
      });
      it("does not turn the convenience single-edition link into identifier ownership", async () => {
        const workId = await book("Watt", "Samuel Beckett");
        const editionId = await edition(workId);
        const { importId } = await upload(goodreads([line("72001")]));
        await accept(importId);
        await commitReadingImport({ importId });
        expect((await identityRows())[0]).toMatchObject({ entity_kind: "book", work_id: workId, edition_id: null });
        expect(await value(`select edition_id from readings where import_id = $1`, [importId])).toBe(editionId);
      });
      it("journals one repeated ID on the book when accepted rows prove different editions", async () => {
        const workId = await book("Watt", "Samuel Beckett");
        await edition(workId, { isbn13: "9780140449136" });
        await edition(workId, { isbn13: "9780141185064" });
        const { importId } = await upload(goodreads([line("72002", "Watt", { ISBN13: "9780140449136" }), line("72002", "Watt", { ISBN13: "9780141185064" })]));
        await accept(importId, 1); await accept(importId, 2);
        const persisted = await testDb!.query.readingImportRows.findMany({ where: (r, { eq }) => eq(r.importId, importId) });
        expect(await claimImportedGoodreadsIds(importId, persisted.map((r) => ({ ...r, data: r.data, match: r.match, written: r.written })) as StoredRow[])).toBe(1);
        const again = await testDb!.query.readingImportRows.findMany({ where: (r, { eq }) => eq(r.importId, importId) });
        expect(await claimImportedGoodreadsIds(importId, again as unknown as StoredRow[])).toBe(0);
        expect(await identityRows()).toEqual([expect.objectContaining({ entity_kind: "book", work_id: workId, edition_id: null })]);
        expect((await rows(importId)).map((r) => r.written?.identifiers.length)).toEqual([1, 0]);
      });
      it("keeps claim-only ownership across failure and retries the remaining reading", async () => {
        await book("Watt", "Samuel Beckett");
        const { importId } = await upload(goodreads([line("72003")])); await accept(importId);
        vi.mocked(writeReadings).mockRejectedValueOnce(new Error("Reading phase unavailable"));
        await expect(commitReadingImport({ importId })).rejects.toThrow("Reading phase unavailable");
        expect((await rows(importId))[0].written).toMatchObject({ readings: [], identifiers: [expect.any(String)], goodreadsClaim: { externalId: "72003" } });
        const preview = await getImportPreview(importId);
        expect(preview!.summary.toImport).toBe(1);
        expect(Object.values(preview!.sections).flat()[0].written?.goodreadsClaim).toBeTruthy();
        await commitReadingImport({ importId });
        expect(await identityRows()).toHaveLength(1);
        expect(Number(await value(`select count(*) from readings where import_id = $1`, [importId]))).toBe(1);
      });
      it("rolls back the claim itself when its ownership journal cannot be saved", async () => {
        await book("Watt", "Samuel Beckett");
        const { importId } = await upload(goodreads([line("72004")])); await accept(importId);
        await q(`create function test_refuse_claim() returns trigger language plpgsql as $$ begin
          if new.written->'goodreadsClaim' is not null then raise exception 'Claim journal unavailable'; end if; return new; end $$`);
        await q(`create trigger test_refuse_claim before update on reading_import_rows for each row execute function test_refuse_claim()`);
        try { await expect(commitReadingImport({ importId })).rejects.toThrow("Claim journal unavailable"); expect(await identityRows()).toEqual([]); }
        finally { await q(`drop trigger test_refuse_claim on reading_import_rows`); await q(`drop function test_refuse_claim()`); }
        await commitReadingImport({ importId }); expect(await identityRows()).toHaveLength(1);
      });
      it("offers and records the missing ID on an accepted completed legacy row without changing its reading", async () => {
        await book("Watt", "Samuel Beckett");
        const file = goodreads([line("72101")]);
        const { importId } = await upload(file); await accept(importId); await commitReadingImport({ importId });
        // The durable reading is from a legacy import that predates ID preservation.
        await q(`delete from catalogue_identifiers where external_id = '72101'`);
        await q(`update reading_import_rows set written = (written - 'goodreadsClaim' - 'identifierSnapshots') || '{"identifiers":[]}'::jsonb where import_id = $1`, [importId]);
        const before = await q(`select to_jsonb(r) as row from readings r where import_id = $1 order by id`, [importId]);
        expect(before).toHaveLength(1);
        expect(await value(`select status from imports where id=$1`, [importId])).toBe("completed");
        const preview = (await getImportPreview(importId))!;
        expect(preview.summary).toMatchObject({ identifiers: 1, toImport: 0, toQueue: 0, toRate: 0, toSessions: 0, toRestoreNotes: 0 });
        expect(canCommitImport({ identifiers: preview.summary.identifiers, readings: preview.summary.toImport })).toBe(true);
        expect(commitWords(0, 0, 0, 0, 0, 0, preview.summary.identifiers).label).toBe("Record 1 Goodreads ID");
        // A newly uploaded present row remains skipped; it cannot silently backfill the ID.
        const present = await upload(file);
        expect((await rows(present.importId))[0]).toMatchObject({ decision: "skip", match: { section: "present" } });
        expect((await getImportPreview(present.importId))!.summary.identifiers).toBe(0);
        expect(await commitReadingImport({ importId: present.importId })).toMatchObject({ identifiers: 0, written: 0 });
        expect(await identityRows()).toHaveLength(0);
        expect(await commitReadingImport({ importId })).toMatchObject({ identifiers: 1, written: 0 });
        expect(await q(`select to_jsonb(r) as row from readings r where import_id = $1 order by id`, [importId])).toEqual(before);
        const [owned] = await identityRows();
        expect((await rows(importId))[0].written).toMatchObject({ identifiers: [owned.id], identifierSnapshots: [{ id: owned.id }] });
        expect(await commitReadingImport({ importId })).toMatchObject({ identifiers: 0, written: 0 });
        expect(await identityRows()).toEqual([owned]);
        expect((await rows(importId))[0].written?.identifiers).toEqual([owned.id]);
        expect((await rows(importId))[0].written?.identifierSnapshots).toHaveLength(1);
        expect(await q(`select to_jsonb(r) as row from readings r where import_id = $1 order by id`, [importId])).toEqual(before);
        expect(await undoReadingImport({ importId })).toMatchObject({ removed: 1, identifiersKept: 0 });
        expect(await identityRows()).toHaveLength(0);
      });
      it("keeps an ID-only claim when its retained reading was edited", async () => {
        await book("Watt", "Samuel Beckett");
        const { importId } = await upload(goodreads([line("72115")])); await accept(importId); await commitReadingImport({ importId });
        await q(`delete from catalogue_identifiers where external_id = '72115'`);
        await q(`update reading_import_rows set written = (written - 'goodreadsClaim' - 'identifierSnapshots') || '{"identifiers":[]}'::jsonb where import_id=$1`, [importId]);
        await q(`update readings set review_html='<p>Edited legacy reading</p>', updated_at=created_at + interval '1 second' where import_id=$1`, [importId]);
        const before = await q(`select to_jsonb(r) as row from readings r where import_id=$1 order by id`, [importId]);
        expect(await commitReadingImport({ importId })).toMatchObject({ identifiers: 1, written: 0 });
        expect(await undoReadingImport({ importId })).toMatchObject({ removed: 0, kept: 1, identifiersKept: 1 });
        expect(await identityRows()).toHaveLength(1);
        expect(await q(`select to_jsonb(r) as row from readings r where import_id=$1 order by id`, [importId])).toEqual(before);
      });
      it("counts one new ID across concurrent accepted claims for the same owner", async () => {
        await book("Watt", "Samuel Beckett");
        const first = await upload(goodreads([line("72116")])), second = await upload(goodreads([line("72116")]));
        await accept(first.importId); await accept(second.importId);
        const load = async (importId: string) => await testDb!.query.readingImportRows.findMany({ where: (r, { eq }) => eq(r.importId, importId) }) as unknown as StoredRow[];
        const firstRows = await load(first.importId), secondRows = await load(second.importId);
        expect((await Promise.all([claimImportedGoodreadsIds(first.importId, firstRows), claimImportedGoodreadsIds(second.importId, secondRows)])).sort()).toEqual([0, 1]);
        expect(await identityRows()).toHaveLength(1);
        expect([...(await load(first.importId)), ...(await load(second.importId))].reduce((n, row) => n + (row.written?.identifiers.length ?? 0), 0)).toBe(1);
      });
      it("excludes skipped, pending, errored and custom-shelf rows from this commit", async () => {
        await book("Watt", "Samuel Beckett");
        const { importId } = await upload(goodreads([
          line("72102"), line("72103"), line("72104"),
          line("72105", "Watt", { "Exclusive Shelf": "favourites", "Read Count": "0" }), line("72106", ""),
        ]));
        await accept(importId, 1);
        await decideImportRow({ importId, rowNo: 2, decision: "skip" });
        const untouched = await q(`select to_jsonb(r) as row from reading_import_rows r where import_id=$1 and row_no>1 order by row_no`, [importId]);
        expect(await commitReadingImport({ importId })).toMatchObject({ identifiers: 1 });
        expect((await identityRows()).map((r) => r.external_id)).toEqual(["72102"]);
        expect(await q(`select to_jsonb(r) as row from reading_import_rows r where import_id=$1 and row_no>1 order by row_no`, [importId])).toEqual(untouched);
      });
      it("refuses duplicate accepted IDs assigned to different books before any claim", async () => {
        const first = await book("Watt", "Samuel Beckett"); const second = await book("Molloy", "Samuel Beckett");
        const { importId } = await upload(goodreads([line("72107", "First unknown"), line("72107", "Second unknown")]));
        await chooseBook({ importId, rowNo: 1, workId: first }); await chooseBook({ importId, rowNo: 2, workId: second });
        await accept(importId, 1); await accept(importId, 2);
        await expect(commitReadingImport({ importId })).rejects.toThrow("different books");
        expect(await identityRows()).toEqual([]);
      });
      it("revalidates the persisted row data after taking its claim locks", async () => {
        await book("Watt", "Samuel Beckett");
        const { importId } = await upload(goodreads([line("72108")])); await accept(importId);
        const persisted = await testDb!.query.readingImportRows.findMany({ where: (r, { eq }) => eq(r.importId, importId) });
        await q(`update reading_import_rows set data = jsonb_set(data, '{sourceBookId}', '"72109"') where import_id = $1`, [importId]);
        await expect(claimImportedGoodreadsIds(importId, persisted as unknown as StoredRow[])).rejects.toThrow("changed");
        expect(await identityRows()).toEqual([]);
      });
      it("serializes an import and an opposing registry claim on the same ID", async () => {
        await book("Watt", "Samuel Beckett"); const other = await book("Molloy", "Samuel Beckett");
        const { importId } = await upload(goodreads([line("72110")])); await accept(importId);
        const attempts = await Promise.allSettled([
          commitReadingImport({ importId }),
          registerCatalogueIdentifier({ owner: { kind: "book", id: other }, provider: "goodreads", externalId: "72110" }),
        ]);
        expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(attempts.filter((r) => r.status === "rejected")).toHaveLength(1);
        expect(await identityRows()).toHaveLength(1);
      });
      it("re-proves an ISBN match before granting edition ownership", async () => {
        const workId = await book("Watt", "Samuel Beckett");
        const editionId = await edition(workId, { isbn13: "9780140449136" });
        const { importId } = await upload(goodreads([line("72005", "Watt", { ISBN13: "9780140449136" })]));
        await q(`update editions set isbn_13 = null where id = $1`, [editionId]);
        await expect(commitReadingImport({ importId })).rejects.toThrow("changed");
        expect(await identityRows()).toEqual([]);
      });
      it.each(["book", "edition", "legacy-edition", "legacy-url"])("refuses a different-work %s owner after the row was accepted", async (kind) => {
        const workId = await book("Watt", "Samuel Beckett");
        const other = await book("Molloy", "Samuel Beckett");
        const { importId } = await upload(goodreads([line("72006")])); await accept(importId);
        if (kind === "book") await q(`insert into catalogue_identifiers(entity_kind, work_id, provider, external_id) values ('book',$1,'goodreads','72006')`, [other]);
        if (kind === "edition") await registerCatalogueIdentifier({ owner: { kind: "edition", id: await edition(other) }, provider: "goodreads", externalId: "72006" });
        if (kind === "legacy-edition") await edition(other, { goodreadsId: "72006" });
        if (kind === "legacy-url") await q(`update works set goodreads_url = 'https://www.goodreads.com/book/show/72006' where id = $1`, [other]);
        await expect(commitReadingImport({ importId })).rejects.toThrow("Goodreads Book Id");
        await expect(registerCatalogueIdentifier({ owner: { kind: "book", id: workId }, provider: "goodreads", externalId: "72006" })).rejects.toThrow("Goodreads Book Id");
        expect(Number(await value(`select count(*) from readings where import_id = $1`, [importId]))).toBe(0);
      });
      it("serializes opposing registry claims across book and edition namespaces", async () => {
        const first = await book("Watt", "Samuel Beckett"); const second = await book("Molloy", "Samuel Beckett");
        const secondEdition = await edition(second);
        const attempts = await Promise.allSettled([
          registerCatalogueIdentifier({ owner: { kind: "book", id: first }, provider: "goodreads", externalId: "00072007" }),
          registerCatalogueIdentifier({ owner: { kind: "edition", id: secondEdition }, provider: "goodreads", externalId: "72007" }),
        ]);
        expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(attempts.filter((r) => r.status === "rejected")).toHaveLength(1);
        expect(await identityRows()).toHaveLength(1);
      });
      it("retains a shared identity when another import has committed a later reading", async () => {
        await book("Watt", "Samuel Beckett");
        const first = await upload(goodreads([line("72008")])); await accept(first.importId); await commitReadingImport(first);
        const second = await upload(goodreads([line("72008", "Watt", { "Read Count": "2", "Date Read": "2025/01/09" })]));
        await accept(second.importId); await commitReadingImport(second);
        expect((await rows(second.importId))[0].written?.identifiers).toEqual([]);
        expect(await undoReadingImport(first)).toMatchObject({ identifiersKept: 1 });
        expect(await identityRows()).toHaveLength(1);
      });
      it("retains a source-cited identity and an identity moved by an audited merge", async () => {
        const workId = await book("Watt", "Samuel Beckett");
        const { importId } = await upload(goodreads([line("72009")])); await accept(importId); await commitReadingImport({ importId });
        const id = (await identityRows())[0].id as string;
        await recordSourceObservation({ owner: { kind: "book", id: workId }, identifierId: id, provider: "goodreads", retrievedAt: new Date(), payload: {} });
        expect(await undoReadingImport({ importId })).toMatchObject({ identifiersKept: 1 });
        expect(await identityRows()).toHaveLength(1);
        const second = await upload(goodreads([line("72010")])); await accept(second.importId); await commitReadingImport(second);
        const target = await book("Molloy", "Samuel Beckett");
        const merge = await previewMerge("works", workId, target);
        await executeMerge({ entity: "works", sourceId: workId, targetId: target, fingerprint: merge.fingerprint, choices: Object.fromEntries(merge.fields.filter((f) => f.conflict).map((f) => [f.key, "target"])) });
        expect(await undoReadingImport(second)).toMatchObject({ identifiersKept: 1 });
        expect((await identityRows()).find((r) => r.external_id === "72010")?.work_id).toBe(target);
      });
      it("preserves queue claims and prefers exact queue provenance over legitimate alternate IDs", async () => {
        const workId = await book("Watt", "Samuel Beckett");
        const { importId } = await upload(goodreads([line("72011", "Watt", { "Exclusive Shelf": "to-read", "Read Count": "0" })]));
        await accept(importId); await commitReadingImport({ importId });
        const written = (await rows(importId))[0].written!;
        expect(written).toMatchObject({ identifiers: [expect.any(String)], queueOutcome: "written", goodreadsClaim: { externalId: "72011" } });
        await registerCatalogueIdentifier({ owner: { kind: "edition", id: await edition(workId) }, provider: "goodreads", externalId: "72012" });
        expect((await exportIds()).data[0]["Book Id"]).toBe("72011");
        expect(await undoReadingImport({ importId })).toMatchObject({ identifiersKept: 0 });
        expect((await identityRows()).map((r) => r.external_id)).toEqual(["72012"]);
      });
      it("does not trust exact provenance once an unrelated legacy writer creates a cross-book conflict", async () => {
        await book("Watt", "Samuel Beckett");
        const { importId } = await upload(goodreads([line("72111")])); await accept(importId); await commitReadingImport({ importId });
        await book("Conflicting legacy record", "Someone Else", { goodreadsUrl: "https://www.goodreads.com/book/show/72111" });
        const exported = await exportIds(); expect(exported.data[0]["Book Id"]).toBe(""); expect(exported.warning).toBe("1");
        expect((await identityRows())[0].external_id).toBe("72111");
      });
      it("uses only exact reading provenance, warns for ambiguity and rejects a copied source key", async () => {
        const workId = await book("Watt", "Samuel Beckett");
        const { importId } = await upload(goodreads([line("72013")])); await accept(importId); await commitReadingImport({ importId });
        await registerCatalogueIdentifier({ owner: { kind: "edition", id: await edition(workId) }, provider: "goodreads", externalId: "72014" });
        expect((await exportIds()).data[0]["Book Id"]).toBe("72013");
        // The exact same text no longer corroborates when its owning import is a Durtal file.
        await q(`update imports set source = 'durtal' where id = $1`, [importId]);
        const exported = await exportIds();
        expect(exported.data[0]["Book Id"]).toBe("");
        expect(exported.warning).toBe("1"); // the copied key cannot resolve two legitimate catalogue IDs
        await edition(workId, { goodreadsId: "72015" });
        await edition(workId, { goodreadsId: "72016" });
        const ambiguous = await exportIds(); expect(ambiguous.data[0]["Book Id"]).toBe(""); expect(ambiguous.warning).toBe("1");
      });
    });

    it("records the Goodreads id of an edition matched by ISBN, once", async () => {
      const workId = await book("Watt", "Samuel Beckett");
      const editionId = await edition(workId, { isbn13: "9780140449136" });
      const file = goodreads([{ "Book Id": "777", Title: "Watt", Author: "Samuel Beckett", ISBN13: '="9780140449136"', "Exclusive Shelf": "read", "Read Count": "1" }]);
      const { importId } = await upload(file);
      expect((await getImportPreview(importId))!.summary.identifiers).toBe(1);
      await commitReadingImport({ importId });
      const ids = await q(`select id, edition_id, external_id from catalogue_identifiers where provider = 'goodreads'`);
      expect(ids.map((r) => [r.edition_id, r.external_id])).toEqual([[editionId, "777"]]);
      expect((await rows(importId))[0].written!.identifiers).toEqual([ids[0].id]);
      // Without the readings, the next import matches by that id and records nothing
      await q(`delete from readings where import_id = $1`, [importId]);
      const next = await upload(file);
      expect((await rows(next.importId))[0].match.reason).toBe("Same Goodreads id");
      expect((await getImportPreview(next.importId))!.summary.identifiers).toBe(0);
      await undoReadingImport({ importId });
      expect(Number(await value(`select count(*) from catalogue_identifiers`))).toBe(0);
    });

    it("links a book's only copy or only edition to a reading matched by title, taking a Goodreads format from the copy (SLN-1171)", async () => {
      const shelf = await value(`insert into locations(name, type) values ('Study', 'physical') returning id`);
      const copy = (editionId: string, format: string, status = "available") =>
        value(`insert into instances(edition_id, location_id, format, status) values ($1, $2, $3, $4::instance_status_enum) returning id`, [editionId, shelf, format, status]);
      // One e-book copy; one edition and no copy; two editions and one copy; two editions and no copy; one edition with two copies
      const molloy = await book("Molloy", "Samuel Beckett");
      const molloyEd = await edition(molloy, { pages: 240 });
      const molloyCopy = await copy(molloyEd, "ebook");
      const malone = await book("Malone Dies", "Samuel Beckett");
      const maloneEd = await edition(malone);
      const murphy = await book("Murphy", "Samuel Beckett");
      await edition(murphy, { title: "Murphy (first)" });
      const murphyEd = await edition(murphy, { title: "Murphy (second)" });
      const murphyCopy = await copy(murphyEd, "audiobook");
      await copy(await edition(murphy, { title: "Murphy (gone)" }), "paperback", "deaccessioned");
      const mercier = await book("Mercier and Camier", "Samuel Beckett");
      await edition(mercier, { title: "Mercier (one)" });
      await edition(mercier, { title: "Mercier (two)" });
      const watt = await book("Watt", "Samuel Beckett");
      const wattEd = await edition(watt);
      await copy(wattEd, "paperback");
      await copy(wattEd, "hardcover");
      const titles = ["Molloy", "Malone Dies", "Murphy", "Mercier and Camier", "Watt"];
      const { importId } = await upload(goodreads(titles.map((Title) => ({ Title, Author: "Samuel Beckett", "Exclusive Shelf": "read", "Read Count": "1" }))));
      expect((await rows(importId)).map((r) => r.match.editionId)).toEqual([null, null, null, null, null]);
      await decideImportSection({ importId, section: "likely", decision: "import" });
      expect(await commitReadingImport({ importId })).toMatchObject({ written: 5 });
      const linked = async (workId: string) =>
        (await q(`select edition_id, instance_id, format, total_pages from readings where work_id = $1`, [workId])).map((r) => [r.edition_id, r.instance_id, r.format, r.total_pages]);
      expect(await linked(molloy)).toEqual([[molloyEd, molloyCopy, "ebook", 240]]);
      expect(await linked(malone)).toEqual([[maloneEd, null, "print", null]]);
      expect(await linked(murphy)).toEqual([[murphyEd, murphyCopy, "audio", null]]);
      expect(await linked(mercier)).toEqual([[null, null, "print", null]]);
      expect(await linked(watt)).toEqual([[wattEd, null, "print", null]]);
    });

    it("keeps an edited reading on undo, and an undone import can be committed again", async () => {
      const a = await book("Watt", "Samuel Beckett");
      await edition(a, { goodreadsId: "1" });
      const b = await book("Molloy", "Samuel Beckett");
      await edition(b, { goodreadsId: "2" });
      const { importId } = await upload(
        goodreads([
          { "Book Id": "1", Title: "Watt", Author: "Samuel Beckett", "Exclusive Shelf": "read", "Read Count": "1", "Date Read": "2020/01/01" },
          { "Book Id": "2", Title: "Molloy", Author: "Samuel Beckett", "Exclusive Shelf": "read", "Read Count": "1", "Date Read": "2020/02/02" },
        ]),
      );
      await commitReadingImport({ importId });
      await q(`update readings set rating = 4, updated_at = now() + interval '1 second' where work_id = $1`, [a]);
      expect(await undoReadingImport({ importId })).toEqual({ removed: 1, kept: 1, queueRemoved: 0, queueKept: 0, notesRemoved: 0, notesKept: 0, identifiersKept: 0 });
      expect((await readingsOf(a)).length).toBe(1);
      expect((await readingsOf(b)).length).toBe(0);
      expect(await value(`select status from imports where id = $1`, [importId])).toBe("undone");
      const [kept, removed] = await rows(importId);
      expect(kept.written!.readings.length).toBe(1);
      expect(removed.written).toBeNull();
      expect(await commitReadingImport({ importId })).toMatchObject({ written: 1 });
      expect((await readingsOf(b)).length).toBe(1);
      expect((await listReadingImports())[0]).toMatchObject({ id: importId, status: "completed", rawKept: false, readings: 2 });
    });
  });

  describe("the table", () => {
    it("checks the decision, cascades with its import, follows its book", async () => {
      const workId = await book("Watt", "Samuel Beckett");
      await edition(workId, { goodreadsId: "1" });
      const target = await book("Watt (again)", "Samuel Beckett");
      const { importId } = await upload(goodreads([{ "Book Id": "1", Title: "Watt", Author: "Samuel Beckett", "Exclusive Shelf": "read" }]));
      await expect(q(`update reading_import_rows set decision = 'maybe' where import_id = $1`, [importId])).rejects.toThrow(/reading_import_rows_decision_check/);
      const film = await book("A Film", "Nobody", { kind: "film" });
      await expect(q(`update reading_import_rows set work_id = $2 where import_id = $1`, [importId, film])).rejects.toThrow(/book/i);
      // A merge moves the row's book
      const preview = await previewMerge("works", workId, target);
      await executeMerge({ entity: "works", sourceId: workId, targetId: target, fingerprint: preview.fingerprint, choices: Object.fromEntries(preview.fields.filter((f) => f.conflict).map((f) => [f.key, "target"])) });
      expect((await rows(importId))[0].workId).toBe(target);
      // Deleting the book leaves the row without one
      await deleteWork(target);
      expect((await rows(importId))[0].workId).toBeNull();
      await q(`delete from imports where id = $1`, [importId]);
      expect(Number(await value(`select count(*) from reading_import_rows`))).toBe(0);
    });
  });
  describe("an e-book library's ratings and reads (SLN-658)", () => {
    /** A row as the library command makes it: its book, edition and copy named, its rating the row's own */
    async function libraryBook(title: string, over: { rating?: number } = {}) {
      const workId = await book(title, "Samuel Beckett", over);
      const editionId = await edition(workId);
      const location = (await value(`select id from locations where name = 'eBooks'`)) ?? (await value(`insert into locations(name, type) values ('eBooks', 'digital') returning id`));
      const instanceId = await value(`insert into instances(edition_id, location_id) values ($1, $2) returning id`, [editionId, location]);
      return { workId, editionId, instanceId };
    }
    const libraryRow = (ids: { workId: string; editionId: string; instanceId: string }, title: string, rating: number | null, read: string | "undated" | null): ImportRow => ({
      kind: "readings",
      sourceBookId: null,
      title,
      authors: ["Samuel Beckett"],
      isbn13: null,
      isbn10: null,
      fileRating: rating,
      rating,
      reviewHtml: null,
      shelves: [],
      privateNotes: null,
      pages: null,
      extras: {},
      ...ids,
      readings: read
        ? [
            {
              n: 1,
              status: "finished",
              startedOn: null,
              startedPrecision: "unknown",
              finishedOn: read === "undated" ? null : read,
              finishedPrecision: read === "undated" ? "unknown" : "day",
              format: "ebook",
              unit: "percent",
              totalPages: null,
              totalMinutes: null,
              position: null,
              rating: null,
              reviewHtml: null,
              abandonReason: null,
              abandonNote: null,
              readingId: null,
              sourceKey: `ebook-library:lib:${title.toLowerCase()}#1`,
            },
          ]
        : [],
      warnings: [],
      error: null,
    });
    const rating = (id: string) => value<number | null>(`select rating::float8 from works where id = $1`, [id]);

    it("flags every rating that differs and every read, writes nothing until committed, and undoes", async () => {
      const watt = await libraryBook("Watt");
      const molloy = await libraryBook("Molloy", { rating: 3 });
      await reading(molloy.workId, { finishedOn: "2019-05-04", finishedPrecision: "day", format: "ebook" });
      const murphy = await libraryBook("Murphy", { rating: 5 });
      const malone = await libraryBook("Malone Dies", { rating: 2 });
      const mercier = await libraryBook("Mercier and Camier");
      const library = [
        libraryRow(watt, "Watt", 4, "2020-01-02"),
        libraryRow(molloy, "Molloy", 4.5, "2019-05-04"),
        libraryRow(murphy, "Murphy", 5, "2021-03-03"),
        libraryRow(malone, "Malone Dies", 2, null),
        libraryRow(mercier, "Mercier and Camier", 3.5, null),
      ];
      const before = await readingsOf(molloy.workId);
      const { importId, source } = await createLibraryReadingImport({ rows: library, rowNos: [11, 12, 13, 14, 15], name: "E-book library" });
      expect(source).toBe("ebook_library");
      // Nothing is written until the commit
      expect([await rating(watt.workId), await rating(molloy.workId), await rating(mercier.workId)]).toEqual([null, 3, null]);
      expect(await readingsOf(molloy.workId)).toEqual(before);

      const stored = await rows(importId);
      expect(stored.map((r) => [r.rowNo, r.match.reason, r.match.section, r.match.rating, r.decision, r.match.editionId === library[stored.indexOf(r)].editionId])).toEqual([
        [11, "Same Durtal book", "exact", "set", "import", true],
        // Its read is already in Durtal, its rating differs: still to decide, Durtal's kept by default
        [12, "Same Durtal book", "exact", "differs", "import", true],
        [13, "Same Durtal book", "exact", "same", "import", true],
        [14, "Same Durtal book", "present", "same", "skip", true],
        [15, "Same Durtal book", "exact", "set", "import", true],
      ]);
      expect(stored[1].match.verdicts.map((v) => [v.verdict, v.reason])).toEqual([["already_present", "Same finish date"]]);
      const preview = await getImportPreview(importId);
      expect(preview!.header.source).toBe("ebook_library");
      expect(preview!.summary).toMatchObject({ toImport: 2, toRate: 2, ratingsDiffer: 1 });

      // "Use the file's rating" on the one that differs
      await decideImportRow({ importId, rowNo: 12, useFileRating: true });
      expect((await getImportPreview(importId))!.summary.toRate).toBe(3);
      expect(await commitReadingImport({ importId })).toMatchObject({ written: 2, present: 1, ratings: 3, ratingsKept: 0 });
      expect([await rating(watt.workId), await rating(molloy.workId), await rating(murphy.workId), await rating(malone.workId), await rating(mercier.workId)]).toEqual([4, 4.5, 5, 2, 3.5]);
      expect((await readingsOf(watt.workId)).map((r) => [r.source_key, r.finished_on, r.rating])).toEqual([["ebook-library:lib:watt#1", "2020-01-02", null]]);
      expect((await readingsOf(molloy.workId)).length).toBe(1);
      const after = await rows(importId);
      expect(after.map((r) => r.written?.ratingOutcome ?? null)).toEqual(["written", "written", null, null, "written"]);
      expect(after[1].written!.bookRating).toEqual({ workId: molloy.workId, before: 3, after: 4.5 });
      expect((await getImportPreview(importId))!.header.ratings).toBe(3);
      // A settled row is frozen, and a second commit writes nothing
      await expect(decideImportRow({ importId, rowNo: 15, useFileRating: true })).rejects.toThrow("undo the import");
      expect(await commitReadingImport({ importId })).toMatchObject({ written: 0, ratings: 0 });

      // The same library again: everything is already in Durtal
      const again = await createLibraryReadingImport({ rows: library, rowNos: [11, 12, 13, 14, 15], name: "E-book library" });
      expect((await rows(again.importId)).map((r) => r.match.section)).toEqual(["present", "present", "present", "present", "present"]);

      // Undo: the reads go, the ratings come back while they are unchanged
      await q(`update works set rating = 1 where id = $1`, [mercier.workId]);
      await undoReadingImport({ importId });
      expect([await rating(watt.workId), await rating(molloy.workId), await rating(murphy.workId), await rating(mercier.workId)]).toEqual([null, 3, 5, 1]);
      expect((await readingsOf(watt.workId)).length).toBe(0);
      expect((await readingsOf(molloy.workId)).length).toBe(1);
    });

    it("keeps Durtal's reading when the library's read is beside another, unless imported anyway", async () => {
      const watt = await libraryBook("Watt");
      await reading(watt.workId, { finishedOn: "2019-05-04", finishedPrecision: "day", format: "ebook" });
      const molloy = await libraryBook("Molloy");
      await reading(molloy.workId, {});
      const murphy = await libraryBook("Murphy", { rating: 3 });
      await reading(murphy.workId, { status: "reading", startedOn: "2026-09-01", startedPrecision: "day" });
      const library = [libraryRow(watt, "Watt", null, "2021-03-03"), libraryRow(molloy, "Molloy", null, "2021-03-03"), libraryRow(murphy, "Murphy", 4, "2021-03-03")];
      const { importId } = await createLibraryReadingImport({ rows: library, rowNos: [1, 2, 3], name: "E-book library" });
      expect((await rows(importId)).map((r) => [r.match.section, r.decision, r.match.verdicts.map((v) => v.reason)])).toEqual([
        ["present", "skip", ["Another read in Durtal"]],
        ["present", "skip", ["Another read in Durtal"]],
        // Its rating still settles on its own; the read stays out
        ["exact", "import", ["Being read in Durtal"]],
      ]);
      expect((await getImportPreview(importId))!.summary).toMatchObject({ toImport: 0, toRate: 0 });
      // Import anyway on one
      await decideImportRow({ importId, rowNo: 1, decision: "import" });
      expect((await getImportPreview(importId))!.summary.toImport).toBe(1);
      expect(await commitReadingImport({ importId })).toMatchObject({ written: 1, ratings: 0, ratingsKept: 1 });
      expect((await readingsOf(watt.workId)).map((r) => r.finished_on)).toEqual(["2019-05-04", "2021-03-03"]);
      expect((await readingsOf(molloy.workId)).length).toBe(1);
      expect((await readingsOf(murphy.workId)).map((r) => r.status)).toEqual(["reading"]);
      expect(await rating(murphy.workId)).toBe(3);
      // Again: the read imported anyway is now the library's own
      const again = await createLibraryReadingImport({ rows: library, rowNos: [1, 2, 3], name: "E-book library" });
      expect((await rows(again.importId)).map((r) => r.match.verdicts[0].reason)).toEqual(["Same source", "Another read in Durtal", "Being read in Durtal"]);
    });

    it("keeps Durtal's rating unless the row says to replace it", async () => {
      const molloy = await libraryBook("Molloy", { rating: 3 });
      const { importId } = await createLibraryReadingImport({ rows: [libraryRow(molloy, "Molloy", 4, null)], rowNos: [1], name: "E-book library" });
      expect((await rows(importId))[0].match).toMatchObject({ section: "exact", rating: "differs" });
      expect((await getImportPreview(importId))!.summary.toRate).toBe(0);
      expect(await commitReadingImport({ importId })).toMatchObject({ ratings: 0, ratingsKept: 1 });
      expect(await rating(molloy.workId)).toBe(3);
      expect((await rows(importId))[0].written).toMatchObject({ ratingOutcome: "kept", bookRating: null });
    });
  });
  describe("Durtal history restore (SLN-1090)",()=>{
    const download=async(entity:string,format="csv")=>{
      const response=await exportRoute(new NextRequest("http://localhost/api/export",{method:"POST",body:JSON.stringify({entity,format,all:true})}));
      expect(response.status).toBe(200);return response.text();
    };
    const fixture=async()=>{
      const workId=await book("History restore","Author");const editionId=await edition(workId,{pages:200});
      const readingId=await value<string>(`insert into readings(work_id,edition_id,status,format,unit,started_precision,total_pages,start_page,start_percent,current_page,current_percent,current_chapter,source,created_at,updated_at)
        values($1,$2,'reading','ebook','pages','unknown',200,50,25,160,80,'manual position','manual','1969-12-31T23:59:59.123456Z','1970-01-01T00:00:00.000001Z') returning id`,[workId,editionId]);
      const sessionId=await value<string>(`insert into reading_sessions(reading_id,edition_id,format,read_on,time_zone,started_at,ended_at,duration_seconds,start_percent,end_percent,pages_total,note,source,paused_seconds,created_at,updated_at)
        values($1,$2,'ebook','1969-12-31','Europe/Amsterdam','1969-12-31T23:59:58.123456Z','1969-12-31T23:59:59.999999Z',1,25,50,200,E'line\\ttwo\\nthree','timer',7,'1969-12-31T23:59:59.999999Z','1970-01-01T00:00:00.000001Z') returning id`,[readingId,editionId]);
      const thought={type:"doc",content:[{type:"paragraph",content:[{type:"text",text:"code",marks:[{type:"code"}]},{type:"hardBreak"},{type:"text",text:"link",marks:[{type:"link",attrs:{href:"https://example.com",target:"_blank",rel:"noopener noreferrer nofollow",class:null}}]}]}]};
      const noteId=await value<string>(`insert into reading_notes(work_id,reading_id,edition_id,kind,body,comment_html,comment_json,source,created_at,updated_at)
        values($1,$2,$3,'quote',E'  literal\\tpassage\\nnext  ',$4,$5::jsonb,'manual','1969-12-31T23:59:59.999999Z','1970-01-01T00:00:00.000001Z') returning id`,[workId,readingId,editionId,renderThought(thought),JSON.stringify(thought)]);
      return {workId,editionId,readingId,sessionId,noteId,thought};
    };
    const snapshot=async()=>value(`select jsonb_build_object(
      'readings',(select jsonb_agg(to_jsonb(r) order by id) from readings r),
      'sessions',(select jsonb_agg(to_jsonb(s) order by id) from reading_sessions s),
      'notes',(select jsonb_agg(to_jsonb(n) order by id) from reading_notes n))`);

    it("exports and reimports 30 books of readings, sessions and notes without modifying existing records",async()=>{
      for(let i=0;i<30;i++) {
        const workId=await book(`Restore ${i}`,"A Writer");
        const id=await reading(workId,{totalPages:100,finishedOn:"2020-02-02",finishedPrecision:"day"});
        await q(`insert into reading_sessions(reading_id,format,read_on,time_zone,start_percent,end_percent,pages_total,source) values($1,'print','2020-02-02','UTC',0,100,100,'manual')`,[id]);
        await q(`insert into reading_notes(work_id,reading_id,kind,body,source) values($1,$2,'note','Existing edited note','manual')`,[workId,id]);
      }
      const before=await snapshot();
      for(const entity of ["readings","reading-sessions","reading-notes"]) {
        const created=await upload(await download(entity),`${entity}.csv`);
        expect((await rows(created.importId)).map(r=>r.match.section)).toEqual(Array(30).fill("present"));
        expect(await commitReadingImport({importId:created.importId})).toMatchObject({written:0,sessions:0,notes:0});
      }
      expect(await snapshot()).toEqual(before);
    },60000);

    it("formats stored session previews without rewriting raw summaries, exact instants or note previews", async () => {
      await fixture();
      const sessions = await upload(await download("reading-sessions"), "sessions.csv");
      const notes = await upload(await download("reading-notes"), "notes.csv");
      const stored = () => q(`select import_id, row_no, to_jsonb(r) as row from reading_import_rows r where import_id in ($1, $2) order by import_id, row_no`, [sessions.importId, notes.importId]);
      const before = await stored();
      const domainBefore = await snapshot();
      const sessionRows = Object.values((await getImportPreview(sessions.importId))!.sections).flat();
      expect(sessionRows).toHaveLength(1);
      expect(sessionRows[0].data.history?.summary).toBe("31 Dec 1969 · 25–50% · under a minute");
      expect(Object.keys(sessionRows[0].data.history!).sort()).toEqual(["entity", "id", "summary"]);
      expect(sessionRows[0]).not.toHaveProperty("sessionPreview");
      const noteRows = Object.values((await getImportPreview(notes.importId))!.sections).flat();
      expect(noteRows).toHaveLength(1);
      expect(noteRows[0].data.history?.summary).toBe("  literal\tpassage\nnext  ");
      const after = await stored();
      expect(after).toEqual(before);
      expect(await snapshot()).toEqual(domainBefore);
      const saved = ((await rows(sessions.importId))[0].data as ImportRow).history!;
      expect(saved.summary).toBe("1969-12-31 · 25–50% · 1 seconds");
      expect(saved.values.duration_seconds).toBe(1);
      expect(String(saved.values.started_at)).toContain("23:59:58.123456");
      expect(String(saved.values.ended_at)).toContain("23:59:59.999999");
    });

    it("restores new reading UUIDs, exact microseconds, original baselines and rich notes without moving current position",async()=>{
      const f=await fixture();
      const readingFile=await download("readings","tsv"), sessionFile=await download("reading-sessions","tsv"), noteFile=await download("reading-notes","tsv");
      await q(`delete from reading_notes`);await q(`delete from reading_sessions`);await q(`delete from readings`);
      const readingImport=await upload(readingFile,"readings.tsv");
      expect(await commitReadingImport({importId:readingImport.importId})).toMatchObject({written:1});
      const restored=await value<string>(`select id from readings where source_key=$1`,[`durtal:${f.readingId}`]);
      expect(restored).not.toBe(f.readingId);
      const before=await value(`select to_jsonb(r) from readings r where id=$1`,[restored]);
      const sessions=await upload(sessionFile,"sessions.tsv"), notes=await upload(noteFile,"notes.tsv");
      expect((await getImportPreview(sessions.importId))!.summary).toMatchObject({toSessions:1,toImport:0});
      expect(await commitReadingImport({importId:sessions.importId})).toMatchObject({sessions:1});
      expect(await commitReadingImport({importId:notes.importId})).toMatchObject({notes:1});
      expect(await value(`select to_jsonb(r) from readings r where id=$1`,[restored])).toEqual(before);
      expect(await value(`select (extract(epoch from ended_at)*1000000)::bigint::text from reading_sessions where id=$1`,[f.sessionId])).toBe("-1");
      expect(await value(`select (extract(epoch from updated_at)*1000000)::bigint::text from reading_sessions where id=$1`,[f.sessionId])).toBe("1");
      expect(await value(`select reading_id from reading_sessions where id=$1`,[f.sessionId])).toBe(restored);
      expect(await value(`select paused_seconds from reading_sessions where id=$1`,[f.sessionId])).toBe(7);
      const totals=await testDb!.execute(sql`select sum(c.pages)::float8 as pages from ${countedPagesSql()} c where c.reading_id=${restored}::uuid`);
      expect(totals[0].pages).toBe(50);
      expect(await value(`select comment_json from reading_notes where id=$1`,[f.noteId])).toEqual(f.thought);
      const again=await upload(sessionFile,"again.tsv");
      expect((await rows(again.importId))[0].match.section).toBe("present");
      expect(await commitReadingImport({importId:again.importId})).toMatchObject({sessions:0});
      expect(await undoReadingImport({importId:notes.importId})).toMatchObject({notesRemoved:1});
      expect(await undoReadingImport({importId:sessions.importId})).toMatchObject({sessionsRemoved:1});
      expect(await undoReadingImport({importId:readingImport.importId})).toMatchObject({removed:1});
    });

    it("never falls back from a live wrong-book UUID, or guesses a missing parent by title",async()=>{
      const f=await fixture(), other=await book("Wrong book","Author");
      const source=sessionExportRecord(f.readingId,f.workId,f.editionId);
      const wrong=await upload(toCSV([{...source,work_id:other,reading_source_key:`durtal:${f.readingId}`}],SESSION_EXPORT_COLUMNS));
      expect((await rows(wrong.importId))[0].match).toMatchObject({section:"cannot",note:"The reading UUID belongs to another book"});
      const missing=await upload(toCSV([{...source,reading_id:randomUUID(),reading_source_key:"",work_title:"History restore"}],SESSION_EXPORT_COLUMNS));
      expect((await rows(missing.importId))[0].match.section).toBe("cannot");
      expect(await commitReadingImport({importId:wrong.importId})).toMatchObject({sessions:0});
    });

    function sessionExportRecord(readingId:string,workId:string,editionId:string|null=null) {
      return {session_id:randomUUID(),reading_id:readingId,work_id:workId,edition_id:editionId,work_title:"History restore",day:"2020-01-01",time_zone:"UTC",format:"ebook",source:"manual",start_percent:25,end_percent:50,pages_total:200,export_version:3,created_at:"2020-01-01T00:00:00.123456Z",updated_at:"2020-01-01T00:00:00.123456Z"};
    }

    it("resolves legacy parents only through a unique insert-proven mapping",async()=>{
      const workId=await book("Mapped history","Author"), oldId=randomUUID();
      const file=(source_key:string)=>toCSV([{reading_id:oldId,work_id:workId,title:"Mapped history",status:"finished",format:"print",source_key}],DURTAL_READING_COLUMNS);
      const first=await upload(file("legacy:exact-one"));
      expect(await commitReadingImport({importId:first.importId})).toMatchObject({written:1});
      const actual=await value<string>(`select id from readings where source_key='legacy:exact-one'`);
      const legacy={...sessionExportRecord(oldId,workId),session_id:randomUUID()};
      const child=await upload(toCSV([legacy],SESSION_EXPORT_COLUMNS_V2));
      expect(await commitReadingImport({importId:child.importId})).toMatchObject({sessions:1});
      expect(await value(`select reading_id from reading_sessions where id=$1`,[legacy.session_id])).toBe(actual);
      // Historical journals can disagree even though the current writer will not create this ambiguity.
      const secondActual=await value<string>(`insert into readings(work_id,status,format,unit,started_precision,finished_precision,source,source_key)
        values($1,'finished','print','pages','unknown','unknown','manual','legacy:exact-two') returning id`,[workId]);
      const second=await upload(file("legacy:exact-two"));
      await q(`update reading_import_rows set written=$2::jsonb where import_id=$1`,[second.importId,JSON.stringify({parent:{oldReadingId:oldId,oldWorkId:workId,readingId:secondActual,workId,sourceKey:"legacy:exact-two",proof:"inserted"}})]);
      const ambiguous=await upload(toCSV([{...legacy,session_id:randomUUID()}],SESSION_EXPORT_COLUMNS_V2));
      expect((await rows(ambiguous.importId))[0].match).toMatchObject({section:"cannot",note:"Ambiguous reading parent mapping"});
    });

    it("concurrent commits journal ownership only once and preserve existing or edited rows on undo",async()=>{
      const f=await fixture();const source=sessionExportRecord(f.readingId,f.workId,f.editionId);
      const file=toCSV([source],SESSION_EXPORT_COLUMNS), first=await upload(file), second=await upload(file);
      const outcomes=await Promise.all([commitReadingImport({importId:first.importId}),commitReadingImport({importId:second.importId})]);
      expect(outcomes.reduce((n,r)=>n+(r.sessions??0),0)).toBe(1);
      const owners=await q(`select import_id from reading_import_rows where written->'history'->>'id'=$1 and written->'history'->>'created'='true'`,[source.session_id]);
      expect(owners).toHaveLength(1);
      const loser=owners[0].import_id===first.importId?second.importId:first.importId;
      expect(await undoReadingImport({importId:loser})).toMatchObject({sessionsRemoved:0});
      expect(await value(`select count(*)::int from reading_sessions where id=$1`,[source.session_id])).toBe(1);
      await q(`update reading_sessions set note='Edited after import' where id=$1`,[source.session_id]);
      expect(await undoReadingImport({importId:owners[0].import_id})).toMatchObject({sessionsRemoved:0,sessionsKept:1});
    });

    it("keeps unmodified child snapshots after effective parent ownership changes",async()=>{
      const f=await fixture(), source=sessionExportRecord(f.readingId,f.workId,null), file=toCSV([source],SESSION_EXPORT_COLUMNS);
      const created=await upload(file);await commitReadingImport({importId:created.importId});
      const other=await book("Moved parent","Other");
      await q(`update readings set work_id=$1,edition_id=null where id=$2`,[other,f.readingId]);
      expect(await undoReadingImport({importId:created.importId})).toMatchObject({sessionsRemoved:0,sessionsKept:1});
    });

    it("keeps current progress through edition switches and duration-only historical sessions",async()=>{
      const f=await fixture(), otherEdition=await edition(f.workId,{title:"Long edition",pages:500});
      await q(`delete from reading_sessions where reading_id=$1`,[f.readingId]);
      const before=await value(`select to_jsonb(r) from readings r where id=$1`,[f.readingId]);
      const first={...sessionExportRecord(f.readingId,f.workId,f.editionId),created_at:"2020-01-01T00:00:00.100001Z",updated_at:"2020-01-01T00:00:00.100001Z"};
      const second={...sessionExportRecord(f.readingId,f.workId,otherEdition),start_percent:50,end_percent:60,pages_total:500,created_at:"2020-01-01T00:00:00.200001Z",updated_at:"2020-01-01T00:00:00.200001Z"};
      const duration={...sessionExportRecord(f.readingId,f.workId,null),start_percent:null,end_percent:null,pages_total:null,duration_seconds:900,end_chapter:"Old chapter",created_at:"2020-01-01T00:00:00.300001Z",updated_at:"2020-01-01T00:00:00.300001Z"};
      const imported=await upload(toCSV([first,second,duration],SESSION_EXPORT_COLUMNS));
      expect(await commitReadingImport({importId:imported.importId})).toMatchObject({sessions:3});
      expect(await value(`select to_jsonb(r) from readings r where id=$1`,[f.readingId])).toEqual(before);
      const totals=await testDb!.execute(sql`select sum(c.pages)::float8 as pages from ${countedPagesSql()} c where c.reading_id=${f.readingId}::uuid`);
      expect(totals[0].pages).toBe(100);
      expect(await value(`select start_percent::float8 from reading_sessions where id=$1`,[second.session_id])).toBe(50);
    });

    it.each([50,51])("stops stale work when Undo interleaves after the first batch of %i rows",async(count)=>{
      const f=await fixture();const records=Array.from({length:count},()=>sessionExportRecord(f.readingId,f.workId,f.editionId));
      const created=await upload(toCSV(records,SESSION_EXPORT_COLUMNS));
      const original=atomicModule.atomic;let interleaved=false;
      const spy=vi.spyOn(atomicModule,"atomic").mockImplementation(async(build)=>{
        const result=await original(build);
        if(!interleaved && result.length===55) {
          interleaved=true;
          expect(await undoReadingImport({importId:created.importId})).toMatchObject({sessionsRemoved:50});
        }
        return result;
      });
      try {await expect(commitReadingImport({importId:created.importId})).rejects.toThrow("changed through Undo");}
      finally {spy.mockRestore();}
      expect(interleaved).toBe(true);
      expect(await value(`select status from imports where id=$1`,[created.importId])).toBe("undone");
      expect(await value(`select count(*)::int from reading_sessions where id=any($1::uuid[])`,[records.map(r=>r.session_id)])).toBe(0);
      expect(await value(`select count(*)::int from reading_import_rows where import_id=$1 and written->'history' is not null`,[created.importId])).toBe(0);
    });

    it("uses UTC snapshots across different connection timezones and clears only its own journal keys",async()=>{
      const f=await fixture(),source=sessionExportRecord(f.readingId,f.workId,f.editionId);
      const created=await upload(toCSV([source],SESSION_EXPORT_COLUMNS));
      const original=atomicModule.atomic;let zone="Asia/Tokyo";
      const spy=vi.spyOn(atomicModule,"atomic").mockImplementation(async(build)=>{
        const result=await original((d)=>[d.execute(sql`select set_config('TimeZone',${zone},true)`),...build(d)]);
        return result.slice(1);
      });
      try {
        expect(await commitReadingImport({importId:created.importId})).toMatchObject({sessions:1});
        await q(`update reading_import_rows set written=written || '{"retainedEvidence":{"value":"keep"}}'::jsonb where import_id=$1`,[created.importId]);
        zone="America/New_York";
        expect(await undoReadingImport({importId:created.importId})).toMatchObject({sessionsRemoved:1,sessionsKept:0});
      } finally {spy.mockRestore();}
      expect(await value(`select written->'retainedEvidence' from reading_import_rows where import_id=$1`,[created.importId])).toEqual({value:"keep"});
      expect(await value(`select written->'history' from reading_import_rows where import_id=$1`,[created.importId])).toBeNull();
    });

    it("retries after a later atomic chunk fails without duplicating the first 50 sessions",async()=>{
      const f=await fixture();
      const records=Array.from({length:51},(_,i)=>({...sessionExportRecord(f.readingId,f.workId,f.editionId),note:i===50?"stop here":"ok"}));
      const created=await upload(toCSV(records,SESSION_EXPORT_COLUMNS));
      await q(`create function public.durtal_test_reject_restore() returns trigger language plpgsql as $$ begin if new.note='stop here' then raise exception 'synthetic interrupted chunk'; end if; return new; end $$`);
      await q(`create trigger reject_restore before insert on reading_sessions for each row execute function public.durtal_test_reject_restore()`);
      try {await expect(commitReadingImport({importId:created.importId})).rejects.toThrow("synthetic interrupted chunk");}
      finally {await q(`drop trigger reject_restore on reading_sessions`);await q(`drop function public.durtal_test_reject_restore()`);}
      expect(await value(`select count(*)::int from reading_import_rows where import_id=$1 and written->'history'->>'created'='true'`,[created.importId])).toBe(50);
      expect(await commitReadingImport({importId:created.importId})).toMatchObject({sessions:1});
      expect(await value(`select count(*)::int from reading_import_rows where import_id=$1 and written->'history'->>'created'='true'`,[created.importId])).toBe(51);
    });
  });

});
