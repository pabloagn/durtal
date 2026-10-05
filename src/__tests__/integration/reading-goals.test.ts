import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_READING_GOALS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln455_reading_goals")
    throw new Error("Reading goal tests require a disposable local sln455_reading_goals database");
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
import { addSession, finishReading, logProgress, startReading, startTimer } from "@/lib/actions/reading";
import { getGoalHistory, getGoalProgress, getRhythm, removeReadingGoal, setReadingGoal, type GoalProgress } from "@/lib/actions/reading-goals";
import { updateAppSettings } from "@/lib/actions/settings";
import { loadReading } from "@/lib/reading/service";
import { readingToday } from "@/lib/reading/day";
import { addDays } from "@/lib/reading/goals";

/* Reading goals and the weekly rhythm against PostgreSQL (SLN-455). */

const YEAR = 2025;
const ZONE = "Europe/Amsterdam";

describe.skipIf(!url)("reading goals and rhythm with PostgreSQL", () => {
  const q = (text: string, params: unknown[] = []) => client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, params: unknown[] = []) => Object.values((await q(text, params))[0] ?? {})[0] as T;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await q(`truncate works, authors, locations, activity_events, imports, reading_goals, work_types cascade`);
    await q(`delete from app_settings`);
  });

  let serial = 0;
  const book = async (title: string, workTypeId: string | null = null) =>
    value(`insert into works(title, slug, work_type_id) values ($1, $2, $3) returning id`, [title, `${title.toLowerCase().replace(/\W+/g, "-")}-${++serial}`, workTypeId]);
  const edition = async (workId: string, pages: number | null = 480) =>
    value(`insert into editions(work_id, title, language, page_count) values ($1, 'E', 'en', $2) returning id`, [workId, pages]);
  /** A finished read with no sessions */
  const past = (workId: string, o: { on: string | null; precision?: string; pages?: number | null; startPage?: number | null; startedOn?: string | null; status?: string; format?: string }) =>
    value(
      `insert into readings(work_id, status, format, started_on, started_precision, finished_on, finished_precision, total_pages, start_page)
       values ($1, $2, $3, $4::date, case when $4::date is null then 'unknown' else 'day' end, $5::date, $6, $7, $8) returning id`,
      [workId, o.status ?? "finished", o.format ?? "print", o.startedOn ?? null, o.on, o.on ? (o.precision ?? "day") : "unknown", o.pages ?? null, o.startPage ?? null],
    );
  const fp = async (id: string) => (await loadReading(id))!.fingerprint;
  const started = async (title: string, o: { pages?: number; startPage?: number; startedOn: string }) => {
    const workId = await book(title);
    const editionId = await edition(workId, o.pages ?? 480);
    const reading = await startReading({ workId, editionId, startedOn: o.startedOn, startedPrecision: "day", startPage: o.startPage, timeZone: ZONE });
    return { workId, readingId: reading.id };
  };
  const log = async (readingId: string, page: number, readOn: string, extra: Record<string, unknown> = {}) =>
    logProgress({ readingId, fingerprint: await fp(readingId), page, readOn, timeZone: ZONE, ...extra } as never);
  const progress = async (year = YEAR) => Object.fromEntries((await getGoalProgress(year)).map((g) => [g.metric, g])) as Record<string, GoalProgress>;
  const goals = async (target = 1000, extra: Record<string, unknown> = {}) => {
    for (const metric of ["books", "pages", "hours"] as const) await setReadingGoal({ year: YEAR, metric, target, ...extra });
  };

  describe("counting", () => {
    it("counts books at day, month and year precision, never unknown dates or abandoned reads", async () => {
      await past(await book("Day"), { on: `${YEAR}-03-14` });
      await past(await book("Month"), { on: `${YEAR}-04-01`, precision: "month" });
      await past(await book("Year"), { on: `${YEAR}-01-01`, precision: "year" });
      await past(await book("Unknown"), { on: null });
      await past(await book("Dropped"), { on: `${YEAR}-05-01`, status: "abandoned" });
      await past(await book("Last year"), { on: `${YEAR - 1}-12-31` });
      await setReadingGoal({ year: YEAR, metric: "books", target: 3 });
      const { books } = await progress();
      expect(books.count).toBe(3);
      // The third counted finish, in date order, reached it: the April one, at month precision
      expect([books.reachedOn, books.reachedPrecision]).toEqual([`${YEAR}-04-01`, "month"]);
    });

    it("leaves out re-reads in every metric when asked, and excluded work types", async () => {
      const w = await book("Twice");
      await past(w, { on: `${YEAR}-02-01`, startedOn: `${YEAR}-01-10`, pages: 300 });
      const reread = await past(w, { on: `${YEAR}-06-01`, startedOn: `${YEAR}-05-10`, pages: 300 });
      // An abandoned first attempt does not make the next read a re-read
      const other = await book("Tried");
      await past(other, { on: `${YEAR}-02-02`, startedOn: `${YEAR}-01-05`, status: "abandoned", pages: 200 });
      await past(other, { on: `${YEAR}-03-01`, startedOn: `${YEAR}-02-10`, pages: 200 });
      // The re-read's one timed session reads it all: 300 pages and an hour
      await q(
        `insert into reading_sessions(reading_id, format, read_on, time_zone, duration_seconds, end_percent, pages_total, source) values ($1, 'print', $2, $3, 3600, 100, 300, 'manual')`,
        [reread, `${YEAR}-05-20`, ZONE],
      );
      const reference = await value(`insert into work_types(name, slug) values ('Reference', 'reference') returning id`);
      await past(await book("Dictionary", reference), { on: `${YEAR}-07-01`, pages: 900 });
      await goals();
      expect(Object.values(await progress()).map((g) => [g.metric, g.count])).toEqual([
        ["books", 4],
        ["pages", 1700],
        ["hours", 1],
      ]);
      await goals(1000, { countRereads: false, excludedWorkTypeIds: [reference] });
      const after = await progress();
      expect([after.books.count, after.pages.count, after.hours.count]).toEqual([2, 500, 0]);
      expect(after.books.excludedWorkTypes).toEqual(["Reference"]);
      // A work type deleted since is ignored
      await q(`delete from work_types where id = $1`, [reference]);
      expect((await progress()).books.count).toBe(3);
    });

    it("counts each page once, from the start page, through the closing session", async () => {
      // A past read with no sessions, from p. 100 of 480
      await past(await book("Past"), { on: `${YEAR}-01-20`, pages: 480, startPage: 100 });
      await setReadingGoal({ year: YEAR, metric: "pages", target: 100_000 });
      expect((await progress()).pages.count).toBe(380);
      // Started at p. 150, logged to p. 212
      const a = await started("From 150", { startPage: 150, startedOn: `${YEAR}-02-01` });
      await log(a.readingId, 212, `${YEAR}-02-02`);
      expect((await progress()).pages.count).toBe(380 + 62);
      // 212, then "I went back" to 112, then 262: 262, never 362
      const b = await started("Back", { startedOn: `${YEAR}-03-01` });
      await log(b.readingId, 212, `${YEAR}-03-02`);
      await log(b.readingId, 112, `${YEAR}-03-03`, { goingBack: "went_back" });
      await log(b.readingId, 262, `${YEAR}-03-04`);
      expect((await progress()).pages.count).toBe(380 + 62 + 262);
      // Logged to p. 400 of 480, then finished: 480
      const c = await started("Finish", { startedOn: `${YEAR}-04-01` });
      await log(c.readingId, 400, `${YEAR}-04-02`);
      await finishReading({ readingId: c.readingId, fingerprint: await fp(c.readingId), finishedOn: `${YEAR}-04-05`, finishedPrecision: "day", timeZone: ZONE });
      expect((await progress()).pages.count).toBe(380 + 62 + 262 + 480);
    });

    it("counts no pages for an audiobook without a page count, says so, and counts its hours", async () => {
      const w = await book("Audio");
      const r = await value(
        `insert into readings(work_id, status, format, unit, total_minutes, started_on, started_precision, finished_precision)
         values ($1, 'reading', 'audio', 'minutes', 600, $2, 'day', 'unknown') returning id`,
        [w, `${YEAR}-02-01`],
      );
      await q(`insert into reading_sessions(reading_id, format, read_on, time_zone, duration_seconds, end_minutes, source) values ($1, 'audio', $2, $3, 5400, 90, 'manual')`, [r, `${YEAR}-02-02`, ZONE]);
      await goals();
      const p = await progress();
      expect([p.pages.count, p.pages.audioWithoutPages, p.hours.count]).toEqual([0, 1, 1.5]);
    });

    it("puts a session on its reading day: 01:00 on 1 January in Amsterdam and 21:30 on 31 December in Mexico City count for the old year", async () => {
      const a = await started("New year", { startedOn: `${YEAR - 1}-12-01` });
      await addSession({
        readingId: a.readingId,
        fingerprint: await fp(a.readingId),
        readOn: `${YEAR - 1}-12-31`,
        startedAt: new Date(`${YEAR}-01-01T00:00:00Z`),
        durationSeconds: 1800,
        to: { page: 20 },
        timeZone: ZONE,
      });
      await addSession({
        readingId: a.readingId,
        fingerprint: await fp(a.readingId),
        readOn: `${YEAR - 1}-12-31`,
        startedAt: new Date(`${YEAR}-01-01T03:30:00Z`),
        durationSeconds: 1800,
        to: { page: 40 },
        timeZone: "America/Mexico_City",
      });
      expect((await q(`select read_on::text as day, time_zone from reading_sessions where reading_id = $1 order by created_at`, [a.readingId])).map((r) => [r.day, r.time_zone])).toEqual([
        [`${YEAR - 1}-12-31`, ZONE],
        [`${YEAR - 1}-12-31`, "America/Mexico_City"],
      ]);
      for (const year of [YEAR - 1, YEAR]) await setReadingGoal({ year, metric: "hours", target: 10 });
      expect((await progress(YEAR - 1)).hours.count).toBe(1);
      expect((await progress(YEAR)).hours.count).toBe(0);
    });

    it("keeps one goal per metric per year, and removes one", async () => {
      await setReadingGoal({ year: YEAR, metric: "books", target: 30 });
      await setReadingGoal({ year: YEAR, metric: "books", target: 40 });
      await setReadingGoal({ year: YEAR, metric: "hours", target: 100 });
      expect(await q(`select metric, target from reading_goals order by metric`)).toEqual([
        { metric: "books", target: 40 },
        { metric: "hours", target: 100 },
      ]);
      await expect(q(`insert into reading_goals(year, metric, target) values ($1, 'books', 5)`, [YEAR])).rejects.toMatchObject({ code: "23505" });
      await expect(q(`insert into reading_goals(year, metric, target) values ($1, 'shelves', 5)`, [YEAR])).rejects.toMatchObject({ code: "23514" });
      await removeReadingGoal({ year: YEAR, metric: "books" });
      expect(await value<number>(`select count(*)::int from reading_goals`)).toBe(1);
      expect((await getGoalHistory()).map((g) => [g.year, g.metric])).toEqual([[YEAR, "hours"]]);
    });

    it("returns every number as a number", async () => {
      await past(await book("One"), { on: `${YEAR}-03-14`, pages: 321 });
      await goals(10);
      for (const g of await getGoalProgress(YEAR))
        for (const key of ["year", "target", "count", "last90", "avgPages", "audioWithoutPages"] as const) expect(typeof g[key], `${g.metric}.${key}`).toBe("number");
      const rhythm = await getRhythm();
      expect(typeof rhythm.weekStart).toBe("number");
    });
  });

  describe("the rhythm", () => {
    it("is off until set, then lists the reading days by read_on and day-precision finishes, never a running timer", async () => {
      expect(await getRhythm()).toMatchObject({ target: null, days: [] });
      const today = await readingToday();
      const a = await started("Rhythm", { startedOn: addDays(today, -40) });
      await log(a.readingId, 20, addDays(today, -3));
      await log(a.readingId, 40, addDays(today, -1));
      // A finish at day precision without a session marks its day; a month finish does not
      await past(await book("Finished"), { on: addDays(today, -5) });
      await past(await book("Month"), { on: `${today.slice(0, 7)}-01`, precision: "month" });
      // A running timer marks nothing
      const b = await started("Timed", { startedOn: addDays(today, -2) });
      await startTimer({ readingId: b.readingId, timeZone: ZONE });
      expect((await updateAppSettings({ readingRhythmDays: 5 })).ok).toBe(true);
      const monday = await getRhythm();
      expect(monday).toMatchObject({ target: 5, weekStart: 1, today });
      expect(monday.days).toEqual([addDays(today, -5), addDays(today, -3), addDays(today, -1)].sort());
      await updateAppSettings({ readingWeekStart: 7 });
      expect(await getRhythm()).toMatchObject({ target: 5, weekStart: 7, days: monday.days });
      // A session 14 weeks ago is outside the 13 weeks the rhythm needs
      await q(`insert into reading_sessions(reading_id, format, read_on, time_zone, source) values ($1, 'print', $2, $3, 'manual')`, [a.readingId, addDays(today, -7 * 14 - 7), ZONE]);
      expect((await getRhythm()).days).toEqual(monday.days);
      await expect(q(`update app_settings set reading_rhythm_days = 8`)).rejects.toMatchObject({ constraint_name: "app_settings_reading_rhythm_days_check" });
    });
  });
});
