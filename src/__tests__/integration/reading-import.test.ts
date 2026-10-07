import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as schema from "@/lib/db/schema";
import { GOODREADS_EXPORT_HEADER } from "@/lib/reading/import/formats";
import { DURTAL_READING_COLUMNS } from "@/lib/reading/import/durtal-format";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_READING_IMPORT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln450_reading_import")
    throw new Error("Reading import tests require a disposable local sln450_reading_import database");
}
const client = url ? postgres(url, { max: 6, onnotice: () => {} }) : null;
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
import { createReadingImport } from "@/lib/reading/import/store";
import { getImportPreview, listReadingImports } from "@/lib/reading/import/page-data";
import { commitReadingImport, decideImportRow, decideImportSection, rematchImport, undoReadingImport } from "@/lib/actions/reading-import";
import { writeReadings } from "@/lib/reading/service";
import { executeMerge, previewMerge } from "@/lib/harmonization/merge";
import { deleteWork } from "@/lib/actions/works";
import type { ImportMatch } from "@/lib/reading/import/match-rules";
import type { Written } from "@/lib/reading/import/store";

/* The reading import against PostgreSQL (SLN-450): matching, the duplicate
   verdicts, decisions, commit, undo and the table's rules. Every file is
   synthetic, written here. */

describe.skipIf(!url)("the reading import with PostgreSQL", () => {
  const q = (text: string, params: unknown[] = []) => client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, params: unknown[] = []) => Object.values((await q(text, params))[0] ?? {})[0] as T;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await q(`truncate works, authors, locations, activity_events, imports cascade`);
    vi.mocked(writeReadings).mockClear();
  });

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

    it("matches a Durtal file's work id, and drops an edition of another book", async () => {
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
      expect([a.match.reason, a.match.editionId, a.match.warnings]).toEqual(["Same Durtal book", own, []]);
      expect([b.match.editionId, b.match.warnings]).toEqual([null, ["Edition not in Durtal; the reading is kept without it"]]);
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
      expect([same.match.section, same.match.note]).toEqual(["present", "Same reading"]);
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
      expect(await commitReadingImport({ importId })).toEqual({ written: 2, present: 0, refused: 0, rows: 1, queued: 0, queuePresent: 0, queueSkipped: 0, notes: 0, notesPresent: 0 });
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
      expect(await commitReadingImport({ importId })).toEqual({ written: 0, present: 0, refused: 0, rows: 0, queued: 0, queuePresent: 0, queueSkipped: 0, notes: 0, notesPresent: 0 });
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
      await expect(commitReadingImport({ importId })).rejects.toThrow("The connection dropped");
      const half = Number(await value(`select count(*) from readings where import_id = $1`, [importId]));
      expect(half).toBe(100);
      expect(await commitReadingImport({ importId })).toMatchObject({ written: 20 });
      expect(Number(await value(`select count(*) from readings where import_id = $1`, [importId]))).toBe(120);
      expect((await rows(importId)).every((r) => r.written)).toBe(true);
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
      expect(await undoReadingImport({ importId })).toEqual({ removed: 1, kept: 1, queueRemoved: 0, queueKept: 0, notesRemoved: 0, notesKept: 0 });
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
});
