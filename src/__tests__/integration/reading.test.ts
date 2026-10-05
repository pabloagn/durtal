import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_READING_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln444_reading")
    throw new Error("Reading tests require a disposable local sln444_reading database");
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
vi.mock("@/lib/db/atomic", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db/atomic")>();
  return { atomic: vi.fn(real.atomic) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: vi.fn(async () => false),
}));
import {
  abandonReading,
  addPastReading,
  deleteReading,
  deleteSession,
  finishReading,
  getOpenReadings,
  getReadingCounts,
  getReadingsForWork,
  logProgress,
  pauseReading,
  reopenReading,
  restoreReading,
  startReading,
  undoProgress,
  updateReading,
  updateSession,
} from "@/lib/actions/reading";
import { createReading, loadReading, readingFingerprintSql, recordProgress, writeReadings } from "@/lib/reading/service";
import { countedPagesSql, openReadingPercentSql, readCountSql, readingOrdinalSql, readingStateSql } from "@/lib/reading/summary";
import { readingPeriodEnd } from "@/lib/reading/dates";
import { deleteEdition, updateEdition } from "@/lib/actions/editions";
import { deleteInstance } from "@/lib/actions/instances";
import { deleteLocation } from "@/lib/actions/locations";
import { deleteWork } from "@/lib/actions/works";
import { moveToExistingEdition } from "@/lib/actions/identify";
import { executeMerge, previewMerge } from "@/lib/harmonization/merge";
import { loadFilmCards } from "@/lib/catalogue/film-store";
import { loadPerfumeCards } from "@/lib/catalogue/perfume-store";
import { loadPaintingCards } from "@/lib/catalogue/painting-store";
import { getPublisherBooks, parsePublisherBookQuery } from "@/lib/publishers/books";
import { savePublisher } from "@/lib/actions/publishers";
import { atomic } from "@/lib/db/atomic";

describe.skipIf(!url)("the reading tracker with PostgreSQL", () => {
  const db = testDb!;
  const dialect = new PgDialect();
  const q = (text: string, params: unknown[] = []) =>
    client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, params: unknown[] = []) =>
    Object.values((await q(text, params))[0] ?? {})[0] as T;
  const settle = () => new Promise((r) => setTimeout(r, 60));

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await q(`truncate works, authors, locations, activity_events, imports cascade`);
  });

  let serial = 0;
  async function book(title = "Watt") {
    return value(`insert into works(title, slug) values ($1, $2) returning id`, [title, `${title.toLowerCase().replace(/\W+/g, "-")}-${++serial}`]);
  }
  async function edition(workId: string, pages: number | null = 480, title = "Watt") {
    return value(`insert into editions(work_id, title, language, page_count) values ($1, $2, 'en', $3) returning id`, [workId, title, pages]);
  }
  async function place(name: string, type = "physical") {
    return value(`insert into locations(name, type) values ($1, $2) returning id`, [name, type]);
  }
  async function copy(editionId: string, locationId: string, format = "paperback") {
    return value(`insert into instances(edition_id, location_id, format) values ($1, $2, $3) returning id`, [editionId, locationId, format]);
  }
  /** A started reading at a page, with its edition */
  async function started(over: { pages?: number | null; startPage?: number; title?: string } = {}) {
    const workId = await book(over.title);
    const editionId = await edition(workId, over.pages === undefined ? 480 : over.pages);
    const reading = await startReading({ workId, editionId, startedOn: "2026-09-01", startedPrecision: "day", startPage: over.startPage, timeZone: "Europe/Amsterdam" });
    return { workId, editionId, reading };
  }
  const fp = async (id: string) => (await loadReading(id))!.fingerprint;
  async function log(readingId: string, input: Record<string, unknown>) {
    return logProgress({ readingId, fingerprint: await fp(readingId), timeZone: "Europe/Amsterdam", ...input } as never);
  }
  const counted = async (workId: string) =>
    Number(await value(`select coalesce(round(sum(c.pages)), 0)::int from ${countedPagesSqlText()} c where c.work_id = $1`, [workId]));
  /** countedPagesSql as raw text for unsafe() */
  function countedPagesSqlText() {
    const fragment = countedPagesSql();
    return dialect.sqlToQuery(fragment).sql;
  }

  describe("books only", () => {
    it("refuses a film, perfume or painting in the trigger, startReading and writeReadings", async () => {
      for (const kind of ["film", "perfume", "painting"]) {
        const id = await value(`insert into works(kind, title, slug, original_language) values ($1, 'Other', $2, null) returning id`, [kind, `other-${kind}-${++serial}`]);
        await expect(q(`insert into readings(work_id, started_precision) values ($1, 'unknown')`, [id])).rejects.toMatchObject({
          code: "23514",
          constraint_name: "book_parent_required",
        });
        await expect(startReading({ workId: id })).rejects.toThrow("Book not found");
        expect(await writeReadings([{ workId: id, format: "print", status: "finished", startedPrecision: "unknown", finishedPrecision: "unknown" }], { source: "import" })).toEqual([
          { outcome: "refused", reason: "Only books can be read" },
        ]);
      }
    });
  });

  describe("guards and deletes", () => {
    it("refuses an edition of another book, a copy of another edition, a session in another book's edition", async () => {
      const a = await book("A");
      const b = await book("B");
      const ea = await edition(a);
      const eb = await edition(b);
      const shelf = await place("Study");
      const cb = await copy(eb, shelf);
      await expect(q(`insert into readings(work_id, edition_id, started_precision) values ($1, $2, 'unknown')`, [a, eb])).rejects.toMatchObject({
        constraint_name: "reading_edition_work",
      });
      await expect(
        q(`insert into readings(work_id, edition_id, instance_id, started_precision) values ($1, $2, $3, 'unknown')`, [a, ea, cb]),
      ).rejects.toMatchObject({ constraint_name: "reading_instance_edition" });
      const r = await value(`insert into readings(work_id, edition_id, started_precision) values ($1, $2, 'unknown') returning id`, [a, ea]);
      await expect(
        q(`insert into reading_sessions(reading_id, edition_id, format, read_on, time_zone) values ($1, $2, 'print', '2026-10-01', 'UTC')`, [r, eb]),
      ).rejects.toMatchObject({ constraint_name: "reading_session_edition_work" });
    });

    it("keeps the edition when its copy is deleted", async () => {
      const workId = await book();
      const editionId = await edition(workId);
      const copyId = await copy(editionId, await place("Study"));
      const reading = await startReading({ workId, instanceId: copyId, timeZone: "UTC" });
      expect(reading).toMatchObject({ editionId, instanceId: copyId, totalPages: 480 });
      await deleteInstance(copyId);
      expect(await loadReading(reading.id)).toMatchObject({ instanceId: null, editionId });
    });

    it("keeps the page total and the place when the edition of an open reading is deleted", async () => {
      const workId = await book();
      const editionId = await edition(workId);
      const copyId = await copy(editionId, await place("Study"));
      const reading = await startReading({ workId, instanceId: copyId, timeZone: "UTC" });
      await log(reading.id, { page: 100 });
      await deleteEdition(editionId);
      expect(await loadReading(reading.id)).toMatchObject({ editionId: null, instanceId: null, totalPages: 480, currentPage: 100 });
      expect(await q(`select edition_id, pages_total from reading_sessions`)).toEqual([{ edition_id: null, pages_total: 480 }]);
    });

    it("clears the copy and the home when the copy's place is deleted", async () => {
      const workId = await book();
      const editionId = await edition(workId);
      const study = await place("Study");
      const reading = await startReading({ workId, instanceId: await copy(editionId, study), timeZone: "UTC" });
      expect(reading.locationId).toBe(study);
      await deleteLocation(study);
      expect(await loadReading(reading.id)).toMatchObject({ editionId, instanceId: null, locationId: null });
    });

    it("deletes a book with its readings, sessions, history and copies", async () => {
      const workId = await book();
      const editionId = await edition(workId);
      const reading = await startReading({ workId, instanceId: await copy(editionId, await place("Study")), timeZone: "UTC" });
      await log(reading.id, { page: 100 });
      await deleteWork(workId);
      expect(await value<number>(`select count(*)::int from readings`)).toBe(0);
      expect(await value<number>(`select count(*)::int from reading_sessions`)).toBe(0);
      expect(await value<number>(`select count(*)::int from reading_status_history`)).toBe(0);
    });

    it("keeps no home at a digital location", async () => {
      const workId = await book();
      const editionId = await edition(workId);
      const kindle = await place("Kindle", "digital");
      const file = await copy(editionId, kindle, "epub");
      const reading = await startReading({ workId, instanceId: file, timeZone: "UTC" });
      expect(reading).toMatchObject({ locationId: null, format: "ebook", unit: "pages" });
      await expect(startReading({ workId: await book("Other"), locationId: kindle })).rejects.toThrow("A reading's home is a physical place");
    });
  });

  describe("open readings, ordinals and counts", () => {
    it("allows one open reading per book, and re-reads after finishing", async () => {
      const { workId, reading } = await started();
      await expect(startReading({ workId })).rejects.toThrow("This book is already being read");
      const paused = await pauseReading({ readingId: reading.id, fingerprint: reading.fingerprint });
      await expect(startReading({ workId })).rejects.toThrow("This book has a paused reading; resume it");
      await finishReading({ readingId: paused.id, fingerprint: paused.fingerprint, finishedOn: "2026-09-20", finishedPrecision: "day" });
      const again = await startReading({ workId, timeZone: "UTC" });
      expect(again.status).toBe("reading");
    });

    it("numbers readings by their dates, undated Goodreads reads first by key, the open one last", async () => {
      const workId = await book();
      const rows = await writeReadings(
        [
          { workId, format: "print", status: "finished", startedPrecision: "unknown", finishedPrecision: "unknown", sourceKey: "goodreads:9#2" },
          { workId, format: "print", status: "finished", startedPrecision: "unknown", finishedPrecision: "unknown", sourceKey: "goodreads:9#1" },
          { workId, format: "print", status: "abandoned", startedOn: "2015-03-01", startedPrecision: "month", finishedOn: "2015-04-01", finishedPrecision: "month", abandonReason: "prose" },
          { workId, format: "print", status: "finished", startedOn: "2020-01-02", startedPrecision: "day", finishedOn: "2020-02-03", finishedPrecision: "day" },
        ],
        { source: "import" },
      );
      expect(rows.map((r) => r.outcome)).toEqual(["written", "written", "written", "written"]);
      await startReading({ workId, startedOn: "2010-01-01", startedPrecision: "year" });
      const ordinals = await q(
        `select r.source_key, r.status, ${dialect.sqlToQuery(readingOrdinalSql("r")).sql} as n from readings r where r.work_id = $1 order by n`,
        [workId],
      );
      expect(ordinals.map((r) => [r.source_key, r.status, r.n])).toEqual([
        ["goodreads:9#1", "finished", 1],
        ["goodreads:9#2", "finished", 2],
        [null, "abandoned", 3],
        [null, "finished", 4],
        [null, "reading", 5],
      ]);
      const listed = await getReadingsForWork(workId);
      expect(listed.map((r) => r.ordinal).sort()).toEqual([1, 2, 3, 4, 5]);
      expect(listed[0].reading.status).toBe("reading");
      for (const r of listed) expect(r.fingerprint).toBe(await fp(r.reading.id));
      const [state] = await q(
        `select ${dialect.sqlToQuery(readingStateSql(sql.raw("w.id"))).sql} as state, ${dialect.sqlToQuery(readCountSql(sql.raw("w.id"))).sql} as reads from works w where w.id = $1`,
        [workId],
      );
      expect(state).toEqual({ state: "reading", reads: 3 });
    });
  });

  describe("constraints", () => {
    it("refuses bad ratings, misplaced reasons and dates, and a missing precision", async () => {
      const workId = await book();
      const insert = (cols: string, vals: string) => q(`insert into readings(work_id, ${cols}) values ($1, ${vals})`, [workId]);
      await expect(insert("status, started_precision, rating", "'finished', 'unknown', 4.3")).rejects.toMatchObject({ constraint_name: "reading_rating_check" });
      await expect(insert("status, started_precision, rating", "'finished', 'unknown', 0")).rejects.toMatchObject({ constraint_name: "reading_rating_check" });
      await expect(insert("status, started_precision, abandon_reason", "'finished', 'unknown', 'prose'")).rejects.toMatchObject({ constraint_name: "reading_abandon_check" });
      await expect(insert("status, started_precision, finished_on, finished_precision", "'reading', 'unknown', '2026-01-01', 'day'")).rejects.toMatchObject({
        constraint_name: "reading_status_dates_check",
      });
      await expect(insert("status, started_precision", "'finished', 'day'")).rejects.toMatchObject({ constraint_name: "reading_precision_check" });
      await expect(insert("status", "'finished'")).rejects.toMatchObject({ code: "23502" });
      const day = "'finished', '2019-04-14', 'day'";
      await insert("status, started_on, started_precision, finished_on, finished_precision", `${day}, '2019-04-01', 'month'`);
      await insert("status, started_on, started_precision, finished_on, finished_precision", `${day}, '2019-01-01', 'year'`);
      await expect(insert("status, started_on, started_precision, finished_on, finished_precision", `${day}, '2019-03-01', 'month'`)).rejects.toMatchObject({
        constraint_name: "reading_dates_check",
      });
    });

    it("agrees with readingPeriodEnd", async () => {
      for (const [d, p] of [["2019-04-14", "day"], ["2019-04-01", "month"], ["2024-02-01", "month"], ["2019-01-01", "year"]] as const)
        expect(await value(`select public.reading_period_end($1::date, $2)::text`, [d, p])).toBe(readingPeriodEnd(d, p));
    });

    it("takes half-step book ratings and returns numbers from the card loaders", async () => {
      const workId = await book();
      await q(`update works set rating = 4.5 where id = $1`, [workId]);
      await expect(q(`update works set rating = 4.3 where id = $1`, [workId])).rejects.toMatchObject({ constraint_name: "works_rating_check" });
      const film = await value(`insert into works(kind, title, slug, original_language, rating) values ('film', 'F', 'f-card', null, 4.5) returning id`);
      await q(`insert into film_details(work_id) values ($1)`, [film]);
      const perfume = await value(`insert into works(kind, title, slug, original_language, rating) values ('perfume', 'P', 'p-card', null, 4) returning id`);
      await q(`insert into perfume_details(work_id) values ($1)`, [perfume]);
      const painting = await value(`insert into works(kind, title, slug, original_language, rating) values ('painting', 'Q', 'q-card', null, 3.5) returning id`);
      await q(`insert into painting_details(work_id) values ($1)`, [painting]);
      expect((await loadFilmCards([film]))[0].rating).toBe(4.5);
      expect((await loadPerfumeCards([perfume]))[0].rating).toBe(4);
      expect((await loadPaintingCards([painting]))[0].rating).toBe(3.5);
      const house = (await savePublisher({ name: `Reading House ${++serial}` }))!.id;
      const rated = await edition(workId);
      await q(`insert into edition_publishers(edition_id, publisher_id) values ($1, $2)`, [rated, house]);
      const four = await book("Four");
      await q(`update works set rating = 4 where id = $1`, [four]);
      await q(`insert into edition_publishers(edition_id, publisher_id) values ($1, $2)`, [await edition(four), house]);
      const listed = (await getPublisherBooks(house, parsePublisherBookQuery({}))).books;
      expect(listed.map((b) => b.rating).sort()).toEqual([4, 4.5]);
      const { reading } = await started({ title: "Molloy" });
      await log(reading.id, { page: 240 });
      const [row] = await q(`select ${dialect.sqlToQuery(openReadingPercentSql(sql.raw("w.id"))).sql} as p from works w where w.id = $1`, [reading.workId]);
      expect(typeof row.p).toBe("number");
      expect(row.p).toBe(50);
      expect(typeof (await value(`select sum(c.pages) from ${countedPagesSqlText()} c`))).toBe("number");
    });
  });

  describe("positions and progress", () => {
    it("starts where tracking began and counts only what was read after", async () => {
      const { workId, reading } = await started({ startPage: 150 });
      expect(reading).toMatchObject({ startPage: 150, currentPage: 150, startPercent: 31.25 });
      const { session } = await log(reading.id, { page: 170 });
      expect(session).toMatchObject({ startPage: 150, endPage: 170, pagesRead: 20 });
      expect(await counted(workId)).toBe(20);
      const { reading: after } = await deleteSession({ sessionId: session.id, fingerprint: await fp(reading.id) });
      expect(after.currentPage).toBe(150);
    });

    it("keeps a paused reading with an unknown start at its start share", async () => {
      const workId = await book();
      const r = await createReading({ workId, status: "paused", startedPrecision: "unknown", startPercent: 44 }, { source: "manual" });
      expect(r).toMatchObject({ status: "paused", startedOn: null, startedPrecision: "unknown", startPercent: 44, currentPercent: 44 });
    });

    it("works out the share, refuses a page past the end, and resumes a paused reading on a log", async () => {
      const { workId, reading } = await started();
      const { reading: at } = await log(reading.id, { page: 120 });
      expect(at.currentPercent).toBe(25);
      await expect(log(reading.id, { page: 481 })).rejects.toThrow("Page 481 is past the last page, 480");
      const paused = await pauseReading({ readingId: reading.id, fingerprint: await fp(reading.id) });
      const { reading: resumed } = await log(paused.id, { page: 130 });
      expect(resumed.status).toBe("reading");
      await settle();
      expect(await q(`select from_status, to_status from reading_status_history where reading_id = $1 order by changed_at`, [reading.id])).toEqual([
        { from_status: null, to_status: "reading" },
        { from_status: "reading", to_status: "paused" },
        { from_status: "paused", to_status: "reading" },
      ]);
      expect(await value<number>(`select count(*)::int from activity_events where entity_id = $1 and event_key = 'work.reading_resumed'`, [workId])).toBe(1);
      const audio = await book("Audio");
      const r = await startReading({ workId: audio, format: "audio", totalMinutes: 600 });
      expect(r.unit).toBe("minutes");
      expect((await log(r.id, { minutes: 150 })).reading.currentPercent).toBe(25);
    });

    it("fixes a mistaken log, or records going back on purpose", async () => {
      const day = (d: string) => ({ readOn: d });
      // 400 by mistake, then 212 the same day: the mistake is replaced
      let { workId, reading } = await started({ title: "Fix" });
      await log(reading.id, { page: 400, ...day("2026-09-02") });
      let r = await log(reading.id, { page: 212, ...day("2026-09-02") });
      expect(r.wentBack).toBe("fixed_last_log");
      expect(await value<number>(`select count(*)::int from reading_sessions where reading_id = $1`, [reading.id])).toBe(1);
      expect(await counted(workId)).toBe(212);
      // 212, then 112 the same day, then 150 the next day: 150 counted
      ({ workId, reading } = await started({ title: "Fix again" }));
      await log(reading.id, { page: 212, ...day("2026-09-02") });
      await log(reading.id, { page: 112, ...day("2026-09-02") });
      await log(reading.id, { page: 150, ...day("2026-09-03") });
      expect(await counted(workId)).toBe(150);
      // 212, then 112 the next day on purpose, then 150: 212 counted, at 150
      ({ workId, reading } = await started({ title: "Went back" }));
      await log(reading.id, { page: 212, ...day("2026-09-02") });
      r = await log(reading.id, { page: 112, goingBack: "went_back", ...day("2026-09-03") });
      expect(r.wentBack).toBe("went_back");
      const last = await log(reading.id, { page: 150, ...day("2026-09-04") });
      expect(await counted(workId)).toBe(212);
      expect(last.reading.currentPage).toBe(150);
      // A backdated session between two others leaves the position alone
      const before = (await loadReading(reading.id))!;
      await log(reading.id, { page: 50, goingBack: "went_back", ...day("2026-09-02") });
      expect((await loadReading(reading.id))!.currentPage).toBe(before.currentPage);
    });

    it("keeps a reader sitting that ends behind a print log from moving the position", async () => {
      const { workId, reading } = await started({ title: "Reader" });
      await log(reading.id, { page: 212, readOn: "2026-09-02" });
      const sit = await recordProgress({ readingId: reading.id, page: 180, readOn: "2026-09-02", timeZone: "UTC" }, { source: "reader" });
      expect(sit.wentBack).toBeNull();
      expect(await value<number>(`select count(*)::int from reading_sessions where reading_id = $1`, [reading.id])).toBe(2);
      expect(sit.reading.currentPage).toBe(212);
      expect(await counted(workId)).toBe(212);
    });

    it("undoes a new log, a fixed log, and a log that resumed a paused reading", async () => {
      const { reading } = await started({ title: "Undo" });
      const first = await log(reading.id, { page: 100, readOn: "2026-09-02" });
      const second = await log(reading.id, { page: 150, readOn: "2026-09-03" });
      let back = await undoProgress({ readingId: reading.id, fingerprint: await fp(reading.id), undo: second.undo });
      expect(back.currentPage).toBe(100);
      const fixed = await log(reading.id, { page: 90, readOn: "2026-09-02" });
      expect(fixed.wentBack).toBe("fixed_last_log");
      back = await undoProgress({ readingId: reading.id, fingerprint: await fp(reading.id), undo: fixed.undo });
      expect(back.currentPage).toBe(100);
      expect(await value<number>(`select end_page from reading_sessions where id = $1`, [first.session.id])).toBe(100);
      const paused = await pauseReading({ readingId: reading.id, fingerprint: await fp(reading.id) });
      const resumed = await log(paused.id, { page: 120, readOn: "2026-09-04" });
      expect(resumed.undo.repause).toBe(true);
      back = await undoProgress({ readingId: reading.id, fingerprint: await fp(reading.id), undo: resumed.undo });
      expect(back).toMatchObject({ status: "paused", currentPage: 100 });
    });
  });

  describe("finish, abandon and reopen", () => {
    it("closes a reading with a session on the finish day and counts every page", async () => {
      const { workId, reading } = await started({ title: "Finish" });
      await log(reading.id, { page: 212, readOn: "2026-09-02" });
      const { reading: done, undo } = await finishReading({ readingId: reading.id, fingerprint: await fp(reading.id), finishedOn: "2026-09-10", finishedPrecision: "day", rating: 4.5 });
      expect(done).toMatchObject({ status: "finished", currentPage: 480, currentPercent: 100, rating: 4.5 });
      expect(undo.closingSessionId).toBeTruthy();
      expect(await value(`select read_on::text from reading_sessions where id = $1`, [undo.closingSessionId])).toBe("2026-09-10");
      expect(await counted(workId)).toBe(480);
      expect(await value<number>(`select rating::float8 from works where id = $1`, [workId])).toBe(4.5);
      // A month finish puts the closing session on the latest session's day
      const second = await started({ title: "Month" });
      await log(second.reading.id, { page: 100, readOn: "2026-09-05" });
      const month = await finishReading({ readingId: second.reading.id, fingerprint: await fp(second.reading.id), finishedOn: "2026-09-01", finishedPrecision: "month", setBookRating: false, rating: 3 });
      expect(await value(`select read_on::text from reading_sessions where id = $1`, [month.undo.closingSessionId])).toBe("2026-09-05");
      expect(await value(`select rating from works where id = $1`, [second.workId])).toBeNull();
      // A finished reading with no sessions counts from its start page
      const past = await book("Past");
      await writeReadings([{ workId: past, format: "print", status: "finished", startedPrecision: "unknown", finishedOn: "2020-05-01", finishedPrecision: "month", totalPages: 480, position: { page: 100 } }], { source: "manual" });
      expect(await counted(past)).toBe(380);
    });

    it("undoes a finish and an abandon, and puts the book's rating back only if unchanged", async () => {
      const { workId, reading } = await started({ title: "Undo finish" });
      await log(reading.id, { page: 400, readOn: "2026-09-02" });
      const paused = await pauseReading({ readingId: reading.id, fingerprint: await fp(reading.id) });
      const { undo } = await finishReading({ readingId: paused.id, fingerprint: paused.fingerprint, rating: 5 });
      const { reading: back } = await reopenReading({ readingId: reading.id, fingerprint: await fp(reading.id), ...undo });
      expect(back).toMatchObject({ status: "paused", currentPage: 400, finishedOn: null, finishedPrecision: "unknown" });
      expect(await value<number>(`select count(*)::int from reading_sessions where id = $1`, [undo.closingSessionId])).toBe(0);
      expect(await value(`select rating from works where id = $1`, [workId])).toBeNull();
      // The rating changed elsewhere: it is kept
      const again = await finishReading({ readingId: reading.id, fingerprint: await fp(reading.id), rating: 4 });
      await q(`update works set rating = 2 where id = $1`, [workId]);
      const kept = await reopenReading({ readingId: reading.id, fingerprint: await fp(reading.id), ...again.undo });
      expect(kept.message).toBe("The book's rating was changed since; it was kept");
      expect(await value<number>(`select rating::float8 from works where id = $1`, [workId])).toBe(2);
      // Abandon and its undo clear the reason and note
      const stopped = await abandonReading({ readingId: reading.id, fingerprint: await fp(reading.id), reason: "prose", note: "Too dry", page: 420 });
      expect(stopped.reading).toMatchObject({ status: "abandoned", abandonReason: "prose", currentPage: 420 });
      const reopened = await reopenReading({ readingId: reading.id, fingerprint: await fp(reading.id), ...stopped.undo });
      expect(reopened.reading).toMatchObject({ status: "paused", abandonReason: null, abandonNote: null });
      // Reopen is refused while another reading is open
      const done = await finishReading({ readingId: reading.id, fingerprint: await fp(reading.id) });
      await startReading({ workId });
      await expect(reopenReading({ readingId: done.reading.id, fingerprint: await fp(done.reading.id) })).rejects.toThrow("This book is already being read");
    });
  });

  describe("editions, formats and totals", () => {
    it("moves a reading through another edition by its share, without changing its edition", async () => {
      const workId = await book("Mixed");
      const printEd = await edition(workId, 400);
      const ebookEd = await edition(workId, 300, "Watt (e-book)");
      const reading = await startReading({ workId, editionId: printEd });
      await log(reading.id, { page: 100, readOn: "2026-09-02" });
      const r = await recordProgress({ readingId: reading.id, percent: 30, readOn: "2026-09-03", timeZone: "UTC" }, { source: "manual", editionId: ebookEd, format: "ebook" });
      expect(r.reading).toMatchObject({ editionId: printEd, currentPercent: 30, currentPage: 120 });
      expect(await q(`select edition_id, format, pages_total from reading_sessions where reading_id = $1 order by read_on`, [reading.id])).toEqual([
        { edition_id: printEd, format: "print", pages_total: 400 },
        { edition_id: ebookEd, format: "ebook", pages_total: 300 },
      ]);
      await settle();
      expect(await value<number>(`select count(*)::int from activity_events where event_key = 'work.reading_edition_changed'`)).toBe(0);
    });

    it("maps the place onto a new edition, and back after a deleted session", async () => {
      const { workId, reading } = await started({ title: "Switch" });
      await log(reading.id, { page: 212, readOn: "2026-09-02" });
      const other = await edition(workId, 448);
      const switched = await updateReading({ readingId: reading.id, fingerprint: await fp(reading.id), editionId: other });
      expect(switched).toMatchObject({ editionId: other, totalPages: 448, currentPage: 198 });
      const later = await log(reading.id, { page: 250, readOn: "2026-09-03" });
      const { reading: back } = await deleteSession({ sessionId: later.session.id, fingerprint: await fp(reading.id) });
      expect(back).toMatchObject({ currentPage: 198, totalPages: 448 });
      const none = await edition(workId, null);
      const noCount = await updateReading({ readingId: reading.id, fingerprint: await fp(reading.id), editionId: none });
      expect(noCount).toMatchObject({ currentPage: null, unit: "percent" });
    });

    it("refuses a total below the place, and keeps the page when a total grows", async () => {
      const { reading } = await started({ title: "Totals" });
      await log(reading.id, { page: 212 });
      await expect(updateReading({ readingId: reading.id, fingerprint: await fp(reading.id), totalPages: 200 })).rejects.toThrow(
        "You are on p. 212; the book cannot have 200 pages",
      );
      const grown = await updateReading({ readingId: reading.id, fingerprint: await fp(reading.id), totalPages: 500 });
      expect(grown).toMatchObject({ currentPage: 212, totalPages: 500, currentPercent: 42.4 });
    });
  });

  describe("sessions, times and fingerprints", () => {
    it("leaves the running timer out of the position and the counts", async () => {
      const { workId, reading } = await started({ title: "Timer" });
      await log(reading.id, { page: 100, readOn: "2026-09-02" });
      await q(
        `insert into reading_sessions(reading_id, edition_id, format, read_on, time_zone, started_at, source, end_page, end_percent, pages_total)
         values ($1, $2, 'print', '2026-09-03', 'UTC', now(), 'timer', 300, 62.5, 480)`,
        [reading.id, reading.editionId],
      );
      const r = await log(reading.id, { page: 120, readOn: "2026-09-04" });
      expect(r.reading.currentPage).toBe(120);
      expect(await counted(workId)).toBe(120);
    });

    it("stores the local reading day and zone, and refuses an unknown zone", async () => {
      const zone = "America/Mexico_City";
      const workId = await book("Zones");
      const editionId = await edition(workId);
      // 21:30 on 3 March in Mexico City is 03:30 on 4 March in UTC
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-03-04T03:30:00Z"));
      try {
        const reading = await startReading({ workId, editionId, timeZone: zone });
        expect(reading.startedOn).toBe("2026-03-03");
        const r = await logProgress({ readingId: reading.id, fingerprint: reading.fingerprint, page: 20, startedAt: new Date(), timeZone: zone });
        expect(r.session).toMatchObject({ readOn: "2026-03-03", timeZone: zone });
        await expect(logProgress({ readingId: reading.id, fingerprint: await fp(reading.id), page: 30, timeZone: "Mars/Base" })).rejects.toThrow();
        const done = await finishReading({ readingId: reading.id, fingerprint: await fp(reading.id), timeZone: zone });
        expect(done.reading).toMatchObject({ status: "finished", finishedOn: "2026-03-03" });
      } finally {
        vi.useRealTimers();
      }
    });

    it("refuses a stale fingerprint, and retries a fingerprint-less log once", async () => {
      const { reading } = await started({ title: "Stale" });
      // The day before the concurrent logs, so they come after it in reading order
      await log(reading.id, { page: 10, readOn: "2026-09-04" });
      await expect(logProgress({ readingId: reading.id, fingerprint: reading.fingerprint, page: 20 })).rejects.toThrow(
        "This reading changed elsewhere; reload before saving",
      );
      // Two concurrent fingerprint-less logs: one session each, not overlapping
      const [a, b] = await Promise.all([
        recordProgress({ readingId: reading.id, addPages: 5, readOn: "2026-09-05", timeZone: "UTC" }, { source: "manual" }),
        recordProgress({ readingId: reading.id, addPages: 5, readOn: "2026-09-05", timeZone: "UTC" }, { source: "manual" }),
      ]);
      const pages = [a.session.endPage, b.session.endPage].sort();
      expect(pages).toEqual([15, 20]);
      expect((await loadReading(reading.id))!.currentPage).toBe(20);
      const stored = await value(dialect.sqlToQuery(sql`select ${readingFingerprintSql(reading.id)}`).sql, [reading.id]);
      expect(stored).toBe(await fp(reading.id));
      const open = await getOpenReadings();
      expect(open.find((o) => o.reading.id === reading.id)?.fingerprint).toBe(stored);
      expect((await getReadingsForWork(reading.workId))[0].fingerprint).toBe(stored);
    });

    it("recomputes the next session's start and the place after an edit", async () => {
      const { reading } = await started({ title: "Edit" });
      const one = await log(reading.id, { page: 100, readOn: "2026-09-02" });
      const two = await log(reading.id, { page: 150, readOn: "2026-09-03" });
      await updateSession({ sessionId: one.session.id, fingerprint: await fp(reading.id), end: { page: 120 } });
      expect(await value<number>(`select start_page from reading_sessions where id = $1`, [two.session.id])).toBe(120);
      // A manual log at 22:00 after a 20:00-21:00 timer session the same day is the latest
      await q(
        `insert into reading_sessions(reading_id, edition_id, format, read_on, time_zone, started_at, ended_at, source, end_page, end_percent, pages_total)
         values ($1, $2, 'print', '2026-09-04', 'UTC', '2026-09-04T20:00:00Z', '2026-09-04T21:00:00Z', 'timer', 200, 41.67, 480)`,
        [reading.id, reading.editionId],
      );
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-04T22:00:00Z"));
      const later = await log(reading.id, { page: 180, readOn: "2026-09-04" });
      vi.useRealTimers();
      expect(later.reading.currentPage).toBe(180);
    });
  });

  describe("writeReadings and past reads", () => {
    it("writes 250 rows in 3 atomics with their history, and nothing on a second run", async () => {
      const workIds: string[] = [];
      for (let i = 0; i < 25; i++) workIds.push(await book(`Batch ${i}`));
      const rows = workIds.flatMap((workId, i) =>
        Array.from({ length: 10 }, (_, n) => ({
          workId,
          format: "print" as const,
          status: "finished" as const,
          startedPrecision: "unknown" as const,
          finishedOn: `20${String(10 + n).padStart(2, "0")}-01-01`,
          finishedPrecision: "year" as const,
          sourceKey: `goodreads:${i}#${n + 1}`,
        })),
      );
      vi.mocked(atomic).mockClear();
      const first = await writeReadings(rows, { source: "import" });
      expect(first.filter((o) => o.outcome === "written")).toHaveLength(250);
      expect(vi.mocked(atomic)).toHaveBeenCalledTimes(3);
      expect(await value<number>(`select count(*)::int from reading_status_history`)).toBe(250);
      const second = await writeReadings(rows, { source: "import" });
      expect(second.every((o) => o.outcome === "already_present")).toBe(true);
    });

    it("refuses a second open reading, matches the open one, holds a possible duplicate and a bad date", async () => {
      const { workId, reading } = await started({ title: "Rows" });
      const out = await writeReadings(
        [
          { workId, format: "print", status: "reading", startedPrecision: "unknown", finishedPrecision: "unknown" },
          { workId, readingId: reading.id, format: "print", status: "reading", startedPrecision: "unknown", finishedPrecision: "unknown" },
          { workId, format: "print", status: "finished", startedOn: "2019-04-14", startedPrecision: "day", finishedOn: "2019-03-01", finishedPrecision: "month" },
          { workId, format: "print", status: "finished", startedPrecision: "unknown", finishedOn: "2018-01-01", finishedPrecision: "year" },
        ],
        { source: "manual" },
      );
      expect(out.map((o) => o.outcome)).toEqual(["refused", "already_present", "refused", "written"]);
      expect(out[2].reason).toBe("The finish date is before the start date");
      const past = await book("Past");
      await writeReadings([{ workId: past, format: "print", status: "finished", startedPrecision: "unknown", finishedOn: "2019-04-14", finishedPrecision: "day" }], { source: "manual" });
      const undated = { workId: past, format: "print" as const, status: "finished" as const, startedPrecision: "unknown" as const, finishedPrecision: "unknown" as const };
      expect((await writeReadings([undated], { source: "manual" }))[0].outcome).toBe("possible_duplicate");
      expect((await writeReadings([{ ...undated, allowPossibleDuplicate: true }], { source: "manual" }))[0].outcome).toBe("written");
    });

    it("sets the book's rating only if it has none, or replaces it when asked", async () => {
      const workId = await book("Rated");
      await q(`update works set rating = 3 where id = $1`, [workId]);
      const row = { workId, format: "print" as const, status: "finished" as const, startedPrecision: "unknown" as const, finishedPrecision: "year" as const, rating: 4 };
      const kept = await writeReadings([{ ...row, finishedOn: "2018-01-01" }], { source: "import" });
      expect(kept[0].bookRating).toEqual({ before: 3, after: 3 });
      const replaced = await writeReadings([{ ...row, finishedOn: "2019-01-01", bookRating: "replace" }], { source: "import" });
      expect(replaced[0].bookRating).toEqual({ before: 3, after: 4 });
      expect(await value<number>(`select rating::float8 from works where id = $1`, [workId])).toBe(4);
    });

    it("finds an imported read on the same finish day as a reader read", async () => {
      const workId = await book("Reader");
      await writeReadings([{ workId, format: "ebook", status: "finished", startedPrecision: "unknown", finishedOn: "2024-02-03", finishedPrecision: "day", sourceKey: "reader:x" }], { source: "backfill" });
      const out = await writeReadings([{ workId, format: "ebook", status: "finished", startedPrecision: "unknown", finishedOn: "2024-02-03", finishedPrecision: "day", sourceKey: "goodreads:7#1" }], { source: "backfill" });
      expect(out[0].outcome).toBe("already_present");
    });

    it("returns the same reading for a known source key, and names an already logged past read", async () => {
      const workId = await book("Keys");
      const a = await createReading({ workId }, { source: "import", sourceKey: "seed:abc" });
      const b = await createReading({ workId }, { source: "import", sourceKey: "seed:abc" });
      expect(b.id).toBe(a.id);
      const past = await book("Logged");
      const first = await addPastReading({ workId: past, format: "print", status: "finished", startedPrecision: "unknown", finishedOn: "2019-04-14", finishedPrecision: "day" });
      expect(first.outcome).toBe("written");
      const again = await addPastReading({ workId: past, format: "print", status: "finished", startedPrecision: "unknown", finishedOn: "2019-04-14", finishedPrecision: "day" });
      expect(again).toMatchObject({ outcome: "already_present", message: "You already logged this read: finished 14 Apr 2019" });
    });
  });

  describe("delete, restore, history and other code", () => {
    it("restores a deleted reading with the same ids, refusing a second open one", async () => {
      const { workId, editionId, reading } = await started({ title: "Restore" });
      await log(reading.id, { page: 50 });
      const snap = await deleteReading({ readingId: reading.id, fingerprint: await fp(reading.id) });
      expect(await getReadingCounts(workId)).toEqual({ readings: 0, sessions: 0, quotes: 0, notes: 0 });
      await deleteEdition(editionId);
      const back = await restoreReading(JSON.parse(JSON.stringify(snap)));
      expect(back).toMatchObject({ id: reading.id, editionId: null });
      expect(await getReadingCounts(workId)).toEqual({ readings: 1, sessions: 1, quotes: 0, notes: 0 });
      const again = await deleteReading({ readingId: reading.id, fingerprint: await fp(reading.id) });
      await startReading({ workId });
      await expect(restoreReading(JSON.parse(JSON.stringify(again)))).rejects.toThrow("This book is already being read");
    });

    it("records history entries, with one progress entry per reading day", async () => {
      const { workId, reading } = await started({ title: "Events" });
      await settle();
      for (const [page, readOn] of [[20, "2026-09-02"], [40, "2026-09-02"], [60, "2026-09-03"]] as const) {
        await log(reading.id, { page, readOn });
        await settle();
      }
      const keys = await q(`select event_key, metadata->'extra'->>'pages' as pages from activity_events where entity_id = $1 order by created_at`, [workId]);
      expect(keys.filter((k) => k.event_key === "work.reading_progress")).toHaveLength(2);
      expect(keys[0].event_key).toBe("work.reading_started");
      expect(keys.find((k) => k.event_key === "work.reading_progress")?.pages).toBe("20");
    });

    it("blocks a merge of two books both being read, and moves readings otherwise", async () => {
      const a = await started({ title: "Merge A" });
      const b = await started({ title: "Merge B" });
      expect((await previewMerge("works", a.workId, b.workId)).blockers).toContain(
        "Both books have an open reading. Finish, abandon or delete one before merging.",
      );
      await log(a.reading.id, { page: 50 });
      await finishReading({ readingId: a.reading.id, fingerprint: await fp(a.reading.id) });
      const p = await previewMerge("works", a.workId, b.workId);
      expect(p.blockers).toEqual([]);
      await executeMerge({
        entity: "works",
        sourceId: a.workId,
        targetId: b.workId,
        fingerprint: p.fingerprint,
        choices: Object.fromEntries(p.fields.filter((f) => f.conflict).map((f) => [f.key, "target"])),
      });
      expect(await q(`select work_id, status, edition_id is not null as has_edition from readings order by status`)).toEqual([
        { work_id: b.workId, status: "finished", has_edition: true },
        { work_id: b.workId, status: "reading", has_edition: true },
      ]);
      expect(await value<number>(`select count(*)::int from reading_sessions s join readings r on r.id = s.reading_id where r.work_id = $1`, [b.workId])).toBe(2);
    });

    it("clears a moved edition from the old book's readings, and carries a placeholder's readings", async () => {
      const { workId, editionId, reading } = await started({ title: "Move" });
      await log(reading.id, { page: 30 });
      const other = await book("Other book");
      await updateEdition(editionId, { workId: other });
      expect(await q(`select edition_id, instance_id, total_pages from readings where id = $1`, [reading.id])).toEqual([
        { edition_id: null, instance_id: null, total_pages: 480 },
      ]);
      expect(await q(`select edition_id from reading_sessions where reading_id = $1`, [reading.id])).toEqual([{ edition_id: null }]);
      // A placeholder edition's reading follows its copy to the real edition
      const work = await book("Placeholder");
      const placeholderId = await value(`insert into editions(work_id, title, language, metadata_source) values ($1, 'P', 'en', 'phantom_canon') returning id`, [work]);
      const real = await value(`insert into editions(work_id, title, language, isbn_13, page_count) values ($1, 'R', 'en', '9780000000002', 300) returning id`, [work]);
      const shelf = await place("Shelf");
      const c = await copy(placeholderId, shelf);
      const r = await startReading({ workId: work, instanceId: c });
      await log(r.id, { page: 10 });
      await moveToExistingEdition(placeholderId, real);
      expect(await q(`select edition_id, instance_id from readings where id = $1`, [r.id])).toEqual([{ edition_id: real, instance_id: c }]);
      expect(await q(`select edition_id from reading_sessions where reading_id = $1`, [r.id])).toEqual([{ edition_id: real }]);
    });
  });
});
