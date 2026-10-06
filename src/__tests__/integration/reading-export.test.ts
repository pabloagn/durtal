import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_READING_EXPORT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln458_reading_export")
    throw new Error("Reading export tests require a disposable local sln458_reading_export database");
}
const client = url ? postgres(url, { max: 6, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, prop) => {
        if (!testDb) throw new Error("Local test database required");
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
import { POST as exportRoute } from "@/app/api/export/route";
import { GET as statsRoute } from "@/app/api/stats/route";
import { createReadingImport } from "@/lib/reading/import/store";
import { commitReadingImport } from "@/lib/actions/reading-import";
import { parseImportFile } from "@/lib/reading/import/parse";
import { parseCsv } from "@/lib/reading/import/csv";
import { NOTE_EXPORT_COLUMNS, READING_EXPORT_COLUMNS, readingExportRows } from "@/lib/export/reading";
import { countedPagesSql } from "@/lib/reading/summary";
import { readingToday } from "@/lib/reading/day";
import { GOODREADS_EXPORT_HEADER } from "@/lib/reading/import/formats";
import type { ImportMatch } from "@/lib/reading/import/match-rules";

/* The reading exports against PostgreSQL (SLN-458): both round trips write
   nothing, an empty export keeps its header, pages come from countedPagesSql,
   numbers stay numbers, the formula guard, and /api/stats' reading. */

describe.skipIf(!url)("the reading exports with PostgreSQL", () => {
  const q = (text: string, params: unknown[] = []) => client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, params: unknown[] = []) => Object.values((await q(text, params))[0] ?? {})[0] as T;
  const count = async (table: string) => Number(await value(`select count(*) from ${table}`));

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await q(`truncate works, authors, locations, activity_events, imports, reading_goals cascade`);
  });

  let serial = 0;
  /** A book with one author and one edition with an ISBN, so a Goodreads file finds it exactly */
  async function book(title: string, over: { rating?: number; goodreadsId?: string } = {}) {
    serial++;
    const workId = await value(`insert into works(title, slug, rating, original_language) values ($1, $2, $3, 'en') returning id`, [
      title,
      `book-${serial}`,
      over.rating ?? null,
    ]);
    const authorId = await value(`insert into authors(name, slug, sort_name) values ($1, $2, $3) returning id`, [
      `Writer ${serial}`,
      `writer-${serial}`,
      `${serial}, Writer`,
    ]);
    await q(`insert into work_authors(work_id, author_id, role) values ($1, $2, 'author')`, [workId, authorId]);
    const editionId = await value(`insert into editions(work_id, title, language, isbn_13, goodreads_id, page_count) values ($1, $2, 'en', $3, $4, 300) returning id`, [
      workId,
      title,
      `978000000${String(serial).padStart(4, "0")}`,
      over.goodreadsId ?? null,
    ]);
    return { workId, editionId };
  }
  /** A reading as the app or an import stores it */
  async function reading(b: { workId: string; editionId: string }, r: Record<string, unknown>) {
    const columns = { work_id: b.workId, edition_id: b.editionId, format: "print", started_precision: "unknown", finished_precision: "unknown", total_pages: 300, ...r };
    const names = Object.keys(columns);
    return value(
      `insert into readings(${names.join(", ")}) values (${names.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      Object.values(columns),
    );
  }
  async function session(readingId: string, s: Record<string, unknown>) {
    const columns = { reading_id: readingId, format: "print", time_zone: "Europe/Amsterdam", source: "manual", ...s };
    const names = Object.keys(columns);
    return value(`insert into reading_sessions(${names.join(", ")}) values (${names.map((_, i) => `$${i + 1}`).join(", ")}) returning id`, Object.values(columns));
  }

  async function exportFile(entity: string, body: Record<string, unknown> = { all: true }, format = "csv") {
    const res = await exportRoute(
      new NextRequest("http://localhost/api/export", { method: "POST", body: JSON.stringify({ entity, format, ...body }) }),
    );
    // The bytes as sent: Response.text() would drop the byte order mark
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(await res.arrayBuffer());
    return { status: res.status, text, type: res.headers.get("content-type"), name: res.headers.get("content-disposition") };
  }
  const sections = async (importId: string) =>
    (await q(`select match from reading_import_rows where import_id = $1 order by row_no`, [importId])).map((r) => (r.match as ImportMatch).section);
  const written = async () => ({
    readings: await count("readings"),
    history: await count("reading_status_history"),
    queue: await count("reading_queue"),
    notes: await count("reading_notes"),
  });

  /** The round trips' library: readings made in the app (no key), one imported, a half-star book, a title starting with = */
  async function library() {
    const today = await readingToday();
    const open = await book("Open book", { rating: 4.5 });
    const openId = await reading(open, { status: "reading", current_percent: 44.5, current_page: 133, started_on: "2026-01-02", started_precision: "day" });
    await reading(await book("Paused book"), { status: "paused", current_percent: 10 });
    await reading(await book("Abandoned book"), { status: "abandoned", finished_on: "2024-05-04", finished_precision: "day", abandon_reason: "prose" });
    await reading(await book("Undated read"), { status: "finished", rating: 4 });
    const yearly = await book("Twice in 2019");
    await reading(yearly, { status: "finished", finished_on: "2019-01-01", finished_precision: "year" });
    await reading(yearly, { status: "finished", finished_on: "2019-01-01", finished_precision: "year" });
    const reread = await book("Read three times", { rating: 3.5 });
    await reading(reread, { status: "finished", finished_on: "2010-06-01", finished_precision: "month" });
    await reading(reread, { status: "finished", finished_on: "2015-03-02", finished_precision: "day" });
    await reading(reread, { status: "finished", finished_on: "2021-09-10", finished_precision: "day", rating: 4.5, review_html: "<p>Better <em>again</em>.</p>" });
    const imported = await book("Imported", { goodreadsId: "123" });
    await reading(imported, { status: "finished", finished_on: "2018-02-03", finished_precision: "day", source: "import", source_key: "goodreads:123#1" });
    const formula = await book("=Equals");
    const formulaId = await reading(formula, { status: "finished", finished_on: "2020-02-02", finished_precision: "day" });
    await session(formulaId, { read_on: "2020-02-02", end_percent: 100, pages_total: 300 });
    // A passage over a page turn in a known edition (SLN-480)
    await q(`update editions set publication_year = 1999 where id = $1`, [formula.editionId]);
    await q(`insert into reading_notes(work_id, reading_id, edition_id, kind, body, page, end_page) values ($1, $2, $3, 'quote', '=SUM(A1)', 12, 13)`, [
      formula.workId,
      formulaId,
      formula.editionId,
    ]);
    const queued = await book("Up next", { rating: 4.5 });
    await q(`insert into reading_queue(work_id, position) values ($1, 1)`, [queued.workId]);
    // Pages: 0 to 30% of 200 pages counts 60; going back to 20% counts 0; the running timer counts nothing
    await q(`update readings set total_pages = 200 where id = $1`, [openId]);
    await session(openId, { read_on: today, end_percent: 30, pages_total: 200, duration_seconds: 1800 });
    await session(openId, { read_on: today, end_percent: 20, pages_total: 200, duration_seconds: 1800 });
    await session(openId, { read_on: today, source: "timer", started_at: new Date().toISOString(), pages_total: 200 });
    return { openId, formula };
  }

  it("imports its own readings file back with nothing written: every row is already in Durtal", async () => {
    await library();
    const before = await written();
    const file = await exportFile("readings");
    expect(file.status).toBe(200);
    expect(file.type).toBe("text/csv; charset=utf-8");
    const [header, ...cells] = parseCsv(file.text);
    expect(header).toEqual([...READING_EXPORT_COLUMNS]);
    expect(cells).toHaveLength(before.readings);
    // Every row names its reading by id and by key
    const key = header.indexOf("source_key");
    expect(cells.every((row) => row[key])).toBe(true);
    expect(cells.map((row) => row[key]).filter((k) => !k.startsWith("durtal:"))).toEqual(["goodreads:123#1"]);
    const { importId, source } = await createReadingImport({ text: file.text, fileName: "durtal-readings.csv" });
    expect(source).toBe("durtal");
    expect(new Set(await sections(importId))).toEqual(new Set(["present"]));
    expect(await commitReadingImport({ importId })).toMatchObject({ written: 0, queued: 0 });
    expect(await written()).toEqual(before);
  });

  it("writes only the header for no readings, and the importer reads it as a Durtal file with no rows", async () => {
    const file = await exportFile("readings");
    expect(file.status).toBe(200);
    expect(file.text).toBe(`﻿${READING_EXPORT_COLUMNS.join(",")}`);
    const parsed = parseImportFile(file.text);
    expect(parsed.source).toBe("durtal");
    expect(parsed.rows).toEqual([]);
    for (const entity of ["reading-sessions", "reading-notes", "goodreads"]) expect((await exportFile(entity)).status).toBe(200);
    // The Goodreads file is for importing: no byte order mark
    expect((await exportFile("goodreads")).text).toBe(GOODREADS_EXPORT_HEADER.join(","));
    // Parquet with no rows has nothing to write
    expect((await exportFile("readings", { all: true }, "parquet")).status).toBe(404);
  });

  it("imports its own Goodreads file back with nothing written", async () => {
    await library();
    const before = await written();
    const file = await exportFile("goodreads");
    const [header, ...cells] = parseCsv(file.text);
    expect(header).toEqual([...GOODREADS_EXPORT_HEADER]);
    // One row per book with a reading or in Up Next
    expect(cells).toHaveLength(Number(await value(`select count(distinct work_id) from readings`)) + 1);
    const { importId, source } = await createReadingImport({ text: file.text, fileName: "goodreads_library_export.csv" });
    expect(source).toBe("goodreads");
    expect(new Set(await sections(importId))).toEqual(new Set(["present", "to_read"]));
    expect(await commitReadingImport({ importId })).toMatchObject({ written: 0, queued: 0 });
    expect(await written()).toEqual(before);
  });

  it("counts pages with countedPagesSql, leaves out the running timer, and writes numbers as numbers", async () => {
    const { openId } = await library();
    const rows = await readingExportRows([openId]);
    expect(rows[0]).toMatchObject({ pages_read: 60, session_count: 2, minutes_read: 60, current_percent: 44.5 });
    const [{ pages }] = await testDb!.execute<{ pages: number }>(
      // The same total straight from countedPagesSql
      sql`select round(sum(c.pages))::float8 as pages from ${countedPagesSql()} c where c.reading_id = ${openId}::uuid`,
    );
    expect(pages).toBe(60);
    const all = await readingExportRows(null);
    for (const column of ["rating", "current_percent", "pages_read", "session_count", "minutes_read", "total_pages"])
      expect(all.every((row) => row[column] === null || typeof row[column] === "number")).toBe(true);
    const sessions = parseCsv((await exportFile("reading-sessions")).text);
    const [header, ...cells] = sessions;
    const at = (name: string) => header.indexOf(name);
    const open = cells.filter((row) => row[at("reading_id")] === openId);
    expect(open.map((row) => row[at("pages_counted")])).toEqual(["60", "0"]);
    expect(open.map((row) => row[at("end_percent")])).toEqual(["30", "20"]);
    const readingsFile = parseCsv((await exportFile("readings")).text);
    const ratings = readingsFile.slice(1).map((row) => row[readingsFile[0].indexOf("rating")]).filter(Boolean);
    expect(ratings.sort()).toEqual(["4", "4.5"]);
    expect(readingsFile.slice(1).find((row) => row[0] === openId)![readingsFile[0].indexOf("current_percent")]).toBe("44.5");
  });

  it("guards a title or a passage that starts with = in every spreadsheet export, the works export too", async () => {
    const { formula } = await library();
    const guarded = (text: string, cell: string) => text.split(/\r?\n/).some((line) => line.split(",").includes(`'${cell}`));
    expect(guarded((await exportFile("readings")).text, "=Equals")).toBe(true);
    expect(guarded((await exportFile("reading-sessions")).text, "=Equals")).toBe(true);
    expect(guarded((await exportFile("reading-notes")).text, "=SUM(A1)")).toBe(true);
    // Not the Goodreads file, which Goodreads and StoryGraph import: the title goes as stored
    const goodreads = (await exportFile("goodreads")).text;
    expect(guarded(goodreads, "=Equals")).toBe(false);
    expect(goodreads.split("\n").some((line) => line.split(",").includes("=Equals"))).toBe(true);
    expect(guarded((await exportFile("works", { ids: [formula.workId] })).text, "=Equals")).toBe(true);
  });

  it("exports what the journal's and the commonplace book's filters show, and the commonplace book as Markdown", async () => {
    await library();
    const finished = parseCsv((await exportFile("readings", { filters: "status=finished&page=2&perPage=12" })).text).slice(1);
    expect(finished).toHaveLength(Number(await value(`select count(*) from readings where status = 'finished'`)));
    const abandoned = parseCsv((await exportFile("readings", { filters: "status=abandoned" })).text).slice(1);
    expect(abandoned.map((row) => row[7])).toEqual(["abandoned"]);
    const md = await exportFile("reading-notes", { filters: "kind=quote" }, "md");
    expect(md.status).toBe(200);
    expect(md.name).toMatch(/\.md"$/);
    // A leading = is escaped, as it could underline a heading; it reads "=Equals"
    expect(md.text).toContain("## \\=Equals");
    expect(md.text).toContain("> \\=SUM(A1)");
    expect(md.text).toContain("pp. 12–13 · 1999");
    const [noteHeader, noteRow] = parseCsv((await exportFile("reading-notes", { filters: "kind=quote" })).text);
    expect(noteHeader).toEqual([...NOTE_EXPORT_COLUMNS]);
    const cell = (name: string) => noteRow[noteHeader.indexOf(name)];
    expect([cell("page"), cell("end_page"), cell("page_roman"), cell("edition_label"), cell("body")]).toEqual(["12", "13", "no", "1999", "=SUM(A1)"]);
    expect((await exportFile("reading-notes", { filters: "kind=note" })).text.split("\n")).toHaveLength(1);
    // Markdown is the commonplace book's only; the Goodreads file is CSV only
    expect((await exportFile("readings", { all: true }, "md")).status).toBe(400);
    expect((await exportFile("goodreads", { all: true }, "tsv")).status).toBe(400);
    expect((await exportFile("works", { all: true, filters: "q=x" })).status).toBe(400);
  });

  it("gives /api/stats the open readings, the year's numbers and goals", async () => {
    const empty = await (await statsRoute()).json();
    expect(empty.reading).toMatchObject({ open: [], finishedThisYear: 0, pagesThisYear: 0, hoursThisYear: 0, goals: [] });
    const { openId } = await library();
    const year = Number((await readingToday()).slice(0, 4));
    await reading(await book("Finished this year"), { status: "finished", finished_on: `${year}-01-05`, finished_precision: "day", total_pages: 120 });
    await q(`insert into reading_goals(year, metric, target) values ($1, 'books', 10)`, [year]);
    const stats = await (await statsRoute()).json();
    expect(stats.works).toBeGreaterThan(0);
    const [{ pages }] = await testDb!.execute<{ pages: number }>(
      sql`select round(sum(c.pages))::float8 as pages from ${countedPagesSql()} c
        where c.day is not null and c.day_precision <> 'unknown' and extract(year from c.day) = ${year}`,
    );
    expect(stats.reading).toMatchObject({
      year,
      finishedThisYear: 1,
      pagesThisYear: pages,
      hoursThisYear: 1,
      goals: [{ metric: "books", target: 10, progress: 1 }],
    });
    expect(pages).toBe(180);
    expect(stats.reading.open).toEqual(
      expect.arrayContaining([
        { title: "Open book", status: "reading", percent: 44.5 },
        { title: "Paused book", status: "paused", percent: 10 },
      ]),
    );
    expect(await value(`select count(*)::int from reading_sessions where reading_id = $1 and ended_at is null and source = 'timer'`, [openId])).toBe(1);
  });
});
