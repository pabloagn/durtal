import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { renderToStaticMarkup } from "react-dom/server";
import { sql } from "drizzle-orm";
import type { ReactNode } from "react";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_READING_STATS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln456_reading_stats")
    throw new Error("Reading stats tests require a disposable local sln456_reading_stats database");
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
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
vi.mock("next/navigation", async (original) => ({ ...(await original<typeof import("next/navigation")>()), usePathname: () => "/reading/year" }));
// EB Garamond loads through next/font, which needs the Next compiler
vi.mock("@/components/shared/prose", () => ({ Prose: ({ children }: { children: ReactNode }) => children }));
import { addSession, finishReading, logProgress, startReading, startTimer } from "@/lib/actions/reading";
import { getWorkCount } from "@/lib/actions/works";
import { loadReading } from "@/lib/reading/service";
import { readingToday } from "@/lib/reading/day";
import { addDays } from "@/lib/reading/goals";
import { tasteRatingSql } from "@/lib/reading/summary";
import { resultRows } from "@/lib/harmonization/store";
import {
  abandoned,
  authorStats,
  eras,
  finishedYears,
  insightInputs,
  languages,
  lengthAndPace,
  onThisDay,
  overTheYear,
  ratings,
  readingDays,
  recommenderStats,
  shelfTime,
  statsYears,
  unreadPile,
  whereAndHow,
  yearNumbers,
  yearReview,
} from "@/lib/reading/stats";
import ReadingYearsPage from "@/app/reading/year/page";
import YearInReviewPage from "@/app/reading/year/[year]/page";

/* Reading stats and the Year in review against PostgreSQL (SLN-456). */

const YEAR = 2025;
const ZONE = "Europe/Amsterdam";

describe.skipIf(!url)("reading stats with PostgreSQL", () => {
  const q = (text: string, params: unknown[] = []) => client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, params: unknown[] = []) => Object.values((await q(text, params))[0] ?? {})[0] as T;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });

  let amsterdam = "";
  let mexico = "";
  let kindle = "";
  beforeEach(async () => {
    await q(`truncate works, authors, locations, activity_events, imports, reading_goals, recommenders cascade`);
    await q(`delete from app_settings`);
    amsterdam = await value(`insert into locations(name, type) values ('Amsterdam', 'physical') returning id`);
    mexico = await value(`insert into locations(name, type) values ('Mexico City', 'physical') returning id`);
    kindle = await value(`insert into locations(name, type) values ('Kindle', 'digital') returning id`);
  });

  let serial = 0;
  const book = async (title: string, o: { rating?: number | null; language?: string | null; year?: number | null; kind?: string } = {}) =>
    value(`insert into works(title, slug, rating, original_language, original_year, kind) values ($1, $2, $3, $4, $5, $6) returning id`, [
      title,
      `book-${++serial}`,
      o.rating ?? null,
      o.language === undefined ? "en" : o.language,
      o.year ?? null,
      o.kind ?? "book",
    ]);
  const edition = (workId: string, o: { pages?: number | null; language?: string } = {}) =>
    value(`insert into editions(work_id, title, language, page_count) values ($1, 'E', $2, $3) returning id`, [workId, o.language ?? "en", o.pages === undefined ? 300 : o.pages]);
  const copy = (editionId: string, o: { at?: string; status?: string; acquired?: string | null } = {}) =>
    value(`insert into instances(edition_id, location_id, status, acquisition_date) values ($1, $2, $3, $4::date) returning id`, [
      editionId,
      o.at ?? amsterdam,
      o.status ?? "available",
      o.acquired ?? null,
    ]);
  interface Past {
    on?: string | null;
    precision?: string;
    status?: string;
    format?: string;
    pages?: number | null;
    startPage?: number | null;
    startedOn?: string | null;
    startedPrecision?: string;
    rating?: number | null;
    editionId?: string | null;
    instanceId?: string | null;
    locationId?: string | null;
    percent?: number | null;
    reason?: string | null;
  }
  /** A reading inserted as it is, with no sessions */
  const past = (workId: string, o: Past = {}) => {
    const on = o.on === undefined ? `${YEAR}-03-14` : o.on;
    return value(
      `insert into readings(work_id, status, format, started_on, started_precision, finished_on, finished_precision, total_pages, start_page, rating,
         edition_id, instance_id, location_id, current_percent, abandon_reason)
       values ($1, $2, $3, $4::date, $5, $6::date, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
      [
        workId,
        o.status ?? "finished",
        o.format ?? "print",
        o.startedOn ?? null,
        o.startedOn ? (o.startedPrecision ?? "day") : "unknown",
        on,
        on ? (o.precision ?? "day") : "unknown",
        o.pages === undefined ? 300 : o.pages,
        o.startPage ?? null,
        o.rating ?? null,
        o.editionId ?? null,
        o.instanceId ?? null,
        o.locationId ?? null,
        o.percent ?? null,
        o.reason ?? null,
      ],
    );
  };
  const session = (
    readingId: string,
    o: { on: string; seconds?: number | null; from?: number; to?: number; total?: number | null; format?: string; zone?: string; startedAt?: string | null; editionId?: string | null },
  ) =>
    q(
      `insert into reading_sessions(reading_id, edition_id, format, source, read_on, time_zone, started_at, ended_at, duration_seconds, pages_total, start_percent, end_percent)
       values ($1, $2, $3, 'manual', $4::date, $5, $6::timestamptz, $6::timestamptz + make_interval(secs => coalesce($7::int, 0)), $7, $8, $9, $10)`,
      [readingId, o.editionId ?? null, o.format ?? "print", o.on, o.zone ?? ZONE, o.startedAt ?? null, o.seconds ?? null, o.total === undefined ? 300 : o.total, o.from ?? 0, o.to ?? 100],
    );
  const fp = async (id: string) => (await loadReading(id))!.fingerprint;
  const started = async (title: string, o: { pages?: number; startPage?: number; startedOn: string }) => {
    const workId = await book(title);
    const editionId = await edition(workId, { pages: o.pages ?? 480 });
    const reading = await startReading({ workId, editionId, startedOn: o.startedOn, startedPrecision: "day", startPage: o.startPage, timeZone: ZONE });
    return { workId, readingId: reading.id };
  };
  const log = async (readingId: string, page: number, readOn: string, extra: Record<string, unknown> = {}) =>
    logProgress({ readingId, fingerprint: await fp(readingId), page, readOn, timeZone: ZONE, ...extra } as never);

  describe("dates and precision", () => {
    it("counts unknown dates in the totals and in no chart, and dates only by year in a Month unknown bar", async () => {
      await past(await book("Day"), { on: `${YEAR}-03-14`, pages: 300 });
      await past(await book("Month"), { on: `${YEAR}-04-01`, precision: "month", pages: 200 });
      await past(await book("Year"), { on: `${YEAR}-01-01`, precision: "year", pages: 100 });
      await past(await book("Unknown"), { on: null, pages: 400 });
      await past(await book("Dropped"), { on: `${YEAR}-05-01`, status: "abandoned", pages: 250, percent: 40 });

      expect(await yearNumbers(YEAR)).toMatchObject({ books: 3, pages: 600, abandoned: 1, undated: 1 });
      const year = await overTheYear(YEAR);
      expect(year.bars.map((b) => b.books)).toEqual([0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(year.bars.map((b) => b.pages)).toEqual([0, 0, 300, 200, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(year.unknown).toEqual({ key: null, books: 1, pages: 100 });

      // All time: the undated book is in the totals, in no bar, and named in the footnote
      expect(await yearNumbers(null)).toMatchObject({ books: 4, pages: 1000, undated: 1 });
      expect(await overTheYear(null)).toEqual({ bars: [{ key: YEAR, books: 3, pages: 600 }], unknown: null, undated: 1 });
    });
  });

  describe("pages and hours", () => {
    it("counts each page once: from the start page, after going back, through the closing session; an audiobook without pages counts none", async () => {
      // Started at p. 150, logged to p. 212: 62
      const a = await started("From 150", { startPage: 150, startedOn: `${YEAR}-02-01` });
      await log(a.readingId, 212, `${YEAR}-02-02`);
      // 212, then "I went back" to 112, then 262: 262, never 362
      const b = await started("Back", { startedOn: `${YEAR}-03-01` });
      await log(b.readingId, 212, `${YEAR}-03-02`);
      await log(b.readingId, 112, `${YEAR}-03-03`, { goingBack: "went_back" });
      await log(b.readingId, 262, `${YEAR}-03-04`);
      // Logged to p. 400 of 480, then finished: 480
      const c = await started("Finish", { startedOn: `${YEAR}-04-01` });
      await log(c.readingId, 400, `${YEAR}-04-02`);
      await finishReading({ readingId: c.readingId, fingerprint: await fp(c.readingId), finishedOn: `${YEAR}-04-05`, finishedPrecision: "day", timeZone: ZONE });
      // An audiobook with minutes and no page count: 90 minutes, no pages
      const w = await book("Audio");
      const r = await value(
        `insert into readings(work_id, status, format, unit, total_minutes, started_on, started_precision, finished_precision)
         values ($1, 'reading', 'audio', 'minutes', 600, $2, 'day', 'unknown') returning id`,
        [w, `${YEAR}-02-01`],
      );
      await q(`insert into reading_sessions(reading_id, format, read_on, time_zone, duration_seconds, end_minutes, source) values ($1, 'audio', $2, $3, 5400, 90, 'manual')`, [
        r,
        `${YEAR}-02-02`,
        ZONE,
      ]);

      const numbers = await yearNumbers(YEAR);
      expect([numbers.pages, numbers.hours, numbers.audioWithoutPages]).toEqual([62 + 262 + 480, 1.5, 1]);
      const months = await overTheYear(YEAR);
      expect(months.bars.slice(1, 4).map((m) => m.pages)).toEqual([62, 262, 480]);
      expect((await whereAndHow(YEAR)).formats).toEqual(
        expect.arrayContaining([
          { format: "audio", minutes: 90, pages: 0, readings: 1 },
          { format: "print", minutes: 0, pages: 804, readings: 3 },
        ]),
      );
    });

    it("leaves the running timer out of the hours, the reading days and the calendar", async () => {
      const today = await readingToday();
      const year = Number(today.slice(0, 4));
      const a = await started("Sessions", { startedOn: addDays(today, -20) });
      await addSession({ readingId: a.readingId, fingerprint: await fp(a.readingId), readOn: addDays(today, -3), durationSeconds: 1800, to: { page: 40 }, timeZone: ZONE });
      const b = await started("Timed", { startedOn: addDays(today, -2) });
      await startTimer({ readingId: b.readingId, timeZone: ZONE });
      // An hour of running time is still running
      await q(`update reading_sessions set started_at = now() - interval '1 hour' where source = 'timer' and ended_at is null`);
      const days = (await readingDays(year)).calendar.map((d) => d.day);
      // The day three days back may be last year's in the first days of January
      if (addDays(today, -3).startsWith(String(year))) expect(days).toEqual([addDays(today, -3)]);
      expect(days).not.toContain(today);
      const numbers = await yearNumbers(year);
      expect(numbers.hours).toBe(addDays(today, -3).startsWith(String(year)) ? 0.5 : 0);
      expect(numbers.readingDays).toBe(days.length);
      expect((await readingDays(year)).weekdays.reduce((s, w) => s + w.sessions, 0)).toBe(days.length);
    });
  });

  describe("days and time zones", () => {
    it("puts a 21:30 session in Mexico City on its local day, in the evening of its local weekday", async () => {
      const a = await started("Night", { startedOn: `${YEAR}-12-01` });
      // 21:30 on Wednesday 31 December in Mexico City is 03:30 on 1 January in UTC and 04:30 in Amsterdam
      await addSession({
        readingId: a.readingId,
        fingerprint: await fp(a.readingId),
        readOn: `${YEAR}-12-31`,
        startedAt: new Date(`${YEAR + 1}-01-01T03:30:00Z`),
        durationSeconds: 1800,
        to: { page: 20 },
        timeZone: "America/Mexico_City",
      });
      // A session with no start time: its weekday by read_on, and no part of the day
      await session(a.readingId, { on: `${YEAR}-12-30`, seconds: 600, from: 4, to: 6, total: 480 });

      const days = await readingDays(YEAR);
      expect(days.calendar.map((d) => [d.day, d.minutes])).toEqual([
        [`${YEAR}-12-30`, 10],
        [`${YEAR}-12-31`, 30],
      ]);
      expect(days.weekdays.map((w) => w.minutes)).toEqual([0, 10, 30, 0, 0, 0, 0]);
      expect(days.partsOfDay).toEqual([
        { part: "night", minutes: 0, sessions: 0 },
        { part: "morning", minutes: 0, sessions: 0 },
        { part: "afternoon", minutes: 0, sessions: 0 },
        { part: "evening", minutes: 30, sessions: 1 },
      ]);
      expect([days.peak, days.withoutStart]).toEqual([{ weekday: 3, part: "evening" }, 1]);
      expect((await readingDays(YEAR + 1)).calendar).toEqual([]);
    });

    it("counts each session under its own format: an audiobook session of a print reading is audio", async () => {
      const w = await book("Two editions");
      const print = await edition(w, { pages: 300 });
      const audio = await edition(w, { pages: null });
      const r = await past(w, { on: `${YEAR}-06-10`, editionId: print, pages: 300 });
      await session(r, { on: `${YEAR}-06-01`, seconds: 3600, from: 0, to: 50, editionId: print });
      await session(r, { on: `${YEAR}-06-08`, seconds: 1800, from: 50, to: 100, format: "audio", editionId: audio });
      // A finished e-book with no sessions counts under its own format
      await past(await book("E-book"), { on: `${YEAR}-07-01`, format: "ebook", pages: 200 });
      const formats = (await whereAndHow(YEAR)).formats;
      expect(formats).toHaveLength(3);
      expect(formats).toEqual(
        expect.arrayContaining([
          { format: "print", minutes: 60, pages: 150, readings: 1 },
          { format: "audio", minutes: 30, pages: 150, readings: 1 },
          { format: "ebook", minutes: 0, pages: 200, readings: 1 },
        ]),
      );
    });

    it("groups Where by the reading's home, so moving a copy later changes nothing", async () => {
      const a = await book("At home");
      // A reading names a copy of its own edition
      const editionA = await edition(a);
      const copyA = await copy(editionA, { at: amsterdam });
      await past(a, { locationId: amsterdam, instanceId: copyA, editionId: editionA });
      await past(await book("Away"), { locationId: mexico });
      await past(await book("Borrowed"), { locationId: null });
      const before = await whereAndHow(YEAR);
      // By name, "Home not recorded" (null) last
      const homes = (w: typeof before) => [...w.homes].sort((x, y) => Number(x.home === null) - Number(y.home === null) || (x.home ?? "").localeCompare(y.home ?? ""));
      expect(homes(before)).toEqual([
        { home: "Amsterdam", readings: 1 },
        { home: "Mexico City", readings: 1 },
        { home: null, readings: 1 },
      ]);
      expect([before.ownCopy, before.noCopy]).toEqual([1, 2]);
      await q(`update instances set location_id = $1 where id = $2`, [mexico, copyA]);
      const after = await whereAndHow(YEAR);
      expect(homes(after)).toEqual(homes(before));
      expect([after.ownCopy, after.noCopy]).toEqual([1, 2]);
    });
  });

  describe("ratings", () => {
    it("uses the read's rating, the book's only for its only finished read, and never a book with no finished read", async () => {
      const recommender = await value(`insert into recommenders(name) values ('M.') returning id`);
      const pick = (workId: string) => q(`insert into work_recommenders(work_id, recommender_id) values ($1, $2)`, [workId, recommender]);
      // Rated 5 as a book, 3 as this year's read
      const a = await book("Five, read as three", { rating: 5 });
      await past(a, { rating: 3, on: `${YEAR}-02-01` });
      // Unrated read, the book's only finished one: the book's 4
      const b = await book("Only read", { rating: 4 });
      await past(b, { rating: null, on: `${YEAR}-03-01` });
      // Rated 4.5 as a book, never finished: nowhere
      const c = await book("Not finished", { rating: 4.5 });
      await past(c, { status: "reading", on: null, startedOn: `${YEAR}-04-01` });
      // Read twice: 3 in 2019, 4.5 this year
      const d = await book("Twice");
      await past(d, { rating: 3, on: "2019-05-01", startedOn: "2019-04-01" });
      await past(d, { rating: 4.5, on: `${YEAR}-05-01`, startedOn: `${YEAR}-04-15` });
      for (const w of [a, b, c, d]) await pick(w);

      const r = await ratings(YEAR);
      expect(r.distribution.filter((x) => x.count)).toEqual([
        { rating: 3, count: 1 },
        { rating: 4, count: 1 },
        { rating: 4.5, count: 1 },
      ]);
      expect(r.distribution).toHaveLength(10);
      expect(r.reread).toEqual([{ workId: d, title: "Twice", slug: expect.any(String), reads: [3, 4.5] }]);
      expect(r.higherOnReread).toBe(1);
      expect((await yearNumbers(YEAR)).avgRating).toBeCloseTo((3 + 4 + 4.5) / 3, 10);
      expect((await yearNumbers(YEAR)).rereads).toBe(1);
      // Recommenders: taste evidence of the picks with a finished read this year (not the unfinished one)
      const [stat] = await recommenderStats(YEAR);
      const [taste] = resultRows<{ avg: number; rated: number }>(
        await testDb!.execute(
          sql`select avg(t)::float8 as avg, count(t)::float8 as rated from (select ${tasteRatingSql(sql`x.id`)} as t from works x where x.id in (${sql.join(
            [a, b, d].map((id) => sql`${id}::uuid`),
            sql`, `,
          )})) x`,
        ),
      );
      expect(stat).toEqual({ recommenderId: recommender, name: "M.", read: 3, rated: taste.rated, avgRating: taste.avg, liked: 3 });
      expect(stat.avgRating).toBeCloseTo(4.5, 10);
      // All time matches too: the 2019 read adds no pick
      expect((await recommenderStats(null))[0]).toEqual(stat);
    });
  });

  describe("shelves", () => {
    it("measures shelf time from the earliest copy that is not deaccessioned, and counts the others apart", async () => {
      const s1 = await book("Five years");
      await copy(await edition(s1), { acquired: "2020-01-01" });
      await past(s1, { startedOn: `${YEAR}-01-01` });
      const s2 = await book("One year");
      const e2 = await edition(s2);
      await copy(e2, { acquired: "2024-06-01" });
      // Its deaccessioned copy's earlier date is ignored
      await copy(e2, { acquired: "2010-01-01", status: "deaccessioned" });
      await past(s2, { on: `${YEAR}-09-01`, startedOn: `${YEAR}-06-01`, startedPrecision: "month" });
      const s3 = await book("Before owned");
      await copy(await edition(s3), { acquired: `${YEAR}-08-01` });
      await past(s3, { startedOn: `${YEAR}-03-01` });
      const s4 = await book("No date");
      await copy(await edition(s4), { acquired: null });
      await past(s4, { startedOn: `${YEAR}-02-01` });
      const s5 = await book("Year only");
      await copy(await edition(s5), { acquired: "2020-01-01" });
      await past(s5, { startedOn: `${YEAR}-01-01`, startedPrecision: "year" });
      // A book first read in 2019 is not this year's
      const s6 = await book("Earlier");
      await copy(await edition(s6), { acquired: "2018-01-01" });
      await past(s6, { on: "2019-03-01", startedOn: "2019-02-01" });
      await past(s6, { startedOn: `${YEAR}-02-01` });

      const shelf = await shelfTime(YEAR);
      expect(shelf).toMatchObject({ counted: 2, avgDays: (1827 + 365) / 2, readBeforeOwned: 1, withoutAcquisitionDate: 1, withoutPreciseStart: 1 });
      expect(shelf.longest.map((b) => [b.title, b.value, b.acquired, b.started])).toEqual([
        ["Five years", 1827, "2020-01-01", `${YEAR}-01-01`],
        ["One year", 365, "2024-06-01", `${YEAR}-06-01`],
      ]);
      expect((await shelfTime(null)).counted).toBe(3);
    });

    it("counts the unread pile as the library's reading=unread and holding=owned, with its pages and copies at hand", async () => {
      const today = await readingToday();
      const u1 = await book("Unread here");
      await copy(await edition(u1, { pages: 300 }), { at: amsterdam });
      const u2 = await book("Unread there");
      await copy(await edition(u2, { pages: 200 }), { at: mexico });
      // Its only copy is deaccessioned: not owned
      const u3 = await book("Gone");
      await copy(await edition(u3, { pages: 999 }), { status: "deaccessioned" });
      // Owned and read
      const u4 = await book("Read");
      await copy(await edition(u4, { pages: 900 }));
      await past(u4, { on: addDays(today, -100), pages: 900 });
      // A digital copy with no page count: at hand in every home
      const u5 = await book("On the Kindle");
      await copy(await edition(u5, { pages: null }), { at: kindle });
      // In storage: owned, not at hand; the first copy's edition gives the pages, not the largest
      const u6 = await book("Stored");
      await copy(await edition(u6, { pages: 150 }), { status: "in_storage" });
      await edition(u6, { pages: 640 });
      // Started, never finished: not unread
      const u7 = await book("Started");
      await copy(await edition(u7));
      await past(u7, { status: "reading", on: null, startedOn: addDays(today, -5) });

      const pile = await unreadPile(today);
      expect(pile).toMatchObject({ books: 4, pages: 650, withoutPages: 1, pagesPerYear: 300 });
      expect(pile.years).toBeCloseTo(650 / 300, 10);
      expect(pile.books).toBe(await getWorkCount(undefined, { reading: ["unread"], holding: "owned" }));
      expect(pile.atHand.map((h) => [h.home, h.books])).toEqual([
        ["Amsterdam", 2],
        ["Mexico City", 2],
      ]);
    });
  });

  describe("books, authors and languages", () => {
    it("measures length and pace by language and the session's format", async () => {
      const long = await book("Long");
      await past(long, { on: `${YEAR}-02-10`, startedOn: `${YEAR}-01-01`, pages: 900 });
      const short = await book("Short");
      await past(short, { on: `${YEAR}-03-03`, startedOn: `${YEAR}-03-01`, pages: 120 });
      // A month-precision start has no day count
      await past(await book("Middle"), { on: `${YEAR}-04-20`, startedOn: `${YEAR}-04-01`, startedPrecision: "month", pages: 320 });
      const fr = await book("Français", { language: "fr" });
      const frEdition = await edition(fr, { pages: 200, language: "fr" });
      const r = await past(fr, { on: `${YEAR}-05-10`, startedOn: `${YEAR}-05-01`, editionId: frEdition, pages: 200 });
      await session(r, { on: `${YEAR}-05-02`, seconds: 3600, from: 0, to: 30, total: 200, editionId: frEdition });
      await session(r, { on: `${YEAR}-05-05`, seconds: 3600, from: 30, to: 60, total: 200, editionId: frEdition });
      // 20 minutes alone is too little to give a pace
      await session(r, { on: `${YEAR}-05-08`, seconds: 1200, from: 60, to: 100, total: 200, format: "ebook" });

      const stats = await lengthAndPace(YEAR);
      expect(stats.lengths.map((l) => l.count)).toEqual([1, 1, 1, 0, 1]);
      expect([stats.longest?.title, stats.longest?.value, stats.shortest?.title, stats.shortest?.value]).toEqual(["Long", 900, "Short", 120]);
      expect([stats.fastest?.title, stats.fastest?.value, stats.slowest?.title, stats.slowest?.value]).toEqual(["Short", 2, "Long", 40]);
      expect(stats.pace).toEqual([{ language: "fr", format: "print", pagesPerHour: 60, hours: 2 }]);
    });

    it("counts languages, translation, translators, authors, countries, gender and eras", async () => {
      // Countries may be reference data already: use France's row, or add it
      await q(`insert into countries(name, alpha_2, alpha_3) values ('France', 'FR', 'FRA') on conflict do nothing`);
      const france = await value(`select id from countries where alpha_2 = 'FR'`);
      const franceName = await value(`select name from countries where alpha_2 = 'FR'`);
      const author = (name: string, o: { country?: string | null; gender?: string | null } = {}) =>
        value(`insert into authors(name, slug, nationality_id, gender) values ($1, $2, $3, $4) returning id`, [name, name.toLowerCase().replace(/\W+/g, "-"), o.country ?? null, o.gender ?? null]);
      const wrote = (workId: string, authorId: string) => q(`insert into work_authors(work_id, author_id) values ($1, $2)`, [workId, authorId]);
      const proust = await author("Marcel Proust", { country: france, gender: "male" });
      const colette = await author("Colette", { country: france, gender: "female" });
      const anon = await author("Anonymous");
      const translator = await author("Lydia Davis");

      const swann = await book("Swann", { language: "fr", year: 1913 });
      const swannEn = await edition(swann, { language: "en", pages: 600 });
      await q(`insert into edition_contributors(edition_id, author_id, role) values ($1, $2, 'translator')`, [swannEn, translator]);
      await past(swann, { on: `${YEAR}-02-01`, editionId: swannEn, pages: 600 });
      await wrote(swann, proust);
      const cheri = await book("Chéri", { language: "fr", year: 1920 });
      await past(cheri, { on: `${YEAR}-03-01`, editionId: await edition(cheri, { language: "fr" }) });
      await wrote(cheri, colette);
      // Read before this year: Colette is not new; the anonymous author is
      const gigi = await book("Gigi", { language: "fr", year: 1944 });
      await past(gigi, { on: "2020-03-01" });
      await wrote(gigi, colette);
      const tale = await book("A tale", { language: "en", year: 1350 });
      await past(tale, { on: `${YEAR}-04-01`, editionId: await edition(tale, { language: "en" }) });
      await wrote(tale, anon);

      const langs = await languages(YEAR);
      expect(langs).toEqual({
        languages: [
          { language: "fr", count: 2 },
          { language: "en", count: 1 },
        ],
        known: 3,
        translated: 1,
        topSource: { language: "fr", count: 1 },
        translators: [{ authorId: translator, name: "Lydia Davis", slug: "lydia-davis", count: 1 }],
      });
      const authors = await authorStats(YEAR);
      expect(authors.byBooks.map((a) => [a.name, a.books])).toEqual([
        ["Anonymous", 1],
        ["Colette", 1],
        ["Marcel Proust", 1],
      ]);
      expect(authors.byPages[0]).toMatchObject({ name: "Marcel Proust", pages: 600 });
      expect(authors.newAuthors.map((a) => a.name)).toEqual(["Anonymous", "Marcel Proust"]);
      expect(authors.countries).toEqual([{ country: franceName, code: "FR", authors: 2 }]);
      expect([...authors.genders].sort((x, y) => String(x.gender).localeCompare(String(y.gender)))).toEqual([
        { gender: "female", authors: 1 },
        { gender: "male", authors: 1 },
        { gender: null, authors: 1 },
      ]);
      const written = await eras(YEAR);
      expect(written.centuries).toEqual([
        { century: 14, count: 1 },
        { century: 20, count: 2 },
      ]);
      expect(written.decades).toEqual([
        { decade: 1350, count: 1 },
        { decade: 1910, count: 1 },
        { decade: 1920, count: 1 },
      ]);
      expect([written.movements, written.workTypes, written.categories]).toEqual([[], [], []]);
    });

    it("counts abandoned books, their reasons and where he usually stops", async () => {
      await past(await book("A"), { status: "abandoned", on: `${YEAR}-02-01`, percent: 20, reason: "prose" });
      await past(await book("B"), { status: "abandoned", on: `${YEAR}-03-01`, percent: 40, reason: "prose" });
      await past(await book("C"), { status: "abandoned", on: `${YEAR}-04-01`, percent: 90 });
      await past(await book("D"), { status: "abandoned", on: "2020-04-01", percent: 5, reason: "content" });
      const stats = await abandoned(YEAR);
      expect(stats.count).toBe(3);
      expect(stats.reasons).toEqual([
        { reason: "prose", count: 2 },
        { reason: null, count: 1 },
      ]);
      expect(stats.medianPercent).toBe(40);
      expect((await abandoned(null)).count).toBe(4);
    });
  });

  describe("numbers, years and the Year in review", () => {
    const seedYear = async () => {
      const w1 = await book("First", { rating: null });
      const e1 = await edition(w1, { pages: 200 });
      const r1 = await past(w1, { on: `${YEAR}-01-05`, startedOn: `${YEAR}-01-01`, rating: 4, editionId: e1, pages: 200, instanceId: await copy(e1, { acquired: "2020-01-01" }) });
      await session(r1, { on: `${YEAR}-01-02`, seconds: 2400, from: 0, to: 100, total: 200, startedAt: `${YEAR}-01-02T19:00:00Z` });
      const w2 = await book("Longest");
      await past(w2, { on: `${YEAR}-03-14`, pages: 900, rating: 3.5 });
      const w3 = await book("Best");
      await past(w3, { on: "2019-03-01", rating: 4 });
      await past(w3, { on: `${YEAR}-03-20`, rating: 5, startedOn: `${YEAR}-03-01` });
      await past(await book("Last"), { on: `${YEAR}-11-01`, precision: "month", rating: 2.5 });
      await past(await book("Some time"), { on: `${YEAR}-01-01`, precision: "year" });
      await past(await book("Dropped"), { status: "abandoned", on: `${YEAR}-06-01`, percent: 33.5, reason: "content" });
      await q(`insert into reading_notes(work_id, kind, body, page, is_favourite) values ($1, 'quote', 'The best line.', 12, true)`, [w3]);
      return { w1, w2, w3 };
    };

    it("returns every rating, percent and average as a number", async () => {
      await seedYear();
      const n = (v: unknown) => expect(typeof v).toBe("number");
      const numbers = await yearNumbers(YEAR);
      for (const v of Object.values(numbers)) n(v);
      for (const d of (await ratings(YEAR)).distribution) [d.rating, d.count].forEach(n);
      for (const r of (await ratings(YEAR)).reread) r.reads.filter((x) => x !== null).forEach(n);
      const length = await lengthAndPace(YEAR);
      [length.longest!.value, length.fastest!.value].forEach(n);
      const inputs = await insightInputs(YEAR);
      for (const g of [inputs.short, inputs.long, inputs.rereads, inputs.firstReads]) [g.count, g.avg ?? 0].forEach(n);
      [inputs.finished, inputs.started].forEach(n);
      n(inputs.long.avg);
      n((await abandoned(YEAR)).medianPercent);
      n((await shelfTime(YEAR)).avgDays);
      for (const m of (await overTheYear(YEAR)).bars) [m.books, m.pages].forEach(n);
      for (const d of (await readingDays(YEAR)).calendar) [d.minutes, d.pages].forEach(n);
      const review = await yearReview(YEAR);
      for (const b of review.books) [b.rating ?? 0, b.pages ?? 0, b.reads].forEach(n);
      n(review.highestRated!.rating);
    });

    it("lists only years with finished books, and the Year in review of any other year is a 404", async () => {
      const { w1, w2, w3 } = await seedYear();
      await past(await book("Undated"), { on: null });
      await past(await book("Stopped"), { status: "abandoned", on: "2023-05-01" });
      expect(await finishedYears()).toEqual([
        { year: YEAR, books: 5 },
        { year: 2019, books: 1 },
      ]);
      expect(await statsYears()).toEqual([YEAR, 2023, 2019]);

      const html = renderToStaticMarkup(await ReadingYearsPage());
      expect([...html.matchAll(/href="(\/reading\/year\/\d+)"/g)].map((m) => m[1])).toEqual([`/reading/year/${YEAR}`, "/reading/year/2019"]);
      for (const year of ["2023", "2024", "abc", "02025"]) await expect(YearInReviewPage({ params: Promise.resolve({ year }) })).rejects.toMatchObject({ digest: expect.stringContaining("404") });

      const review = await yearReview(YEAR);
      expect(review.books.map((b) => [b.title, b.month])).toEqual([
        ["Some time", null],
        ["First", 1],
        ["Longest", 3],
        ["Best", 3],
        ["Last", 11],
      ]);
      expect([review.first?.workId, review.last?.title, review.longest?.workId, review.highestRated?.workId, review.mostReread?.workId]).toEqual([w1, "Last", w2, w3, w3]);
      expect(review.busiestMonth).toEqual({ month: 3, books: 2 });
      expect(review.favouritePassage).toMatchObject({ body: "The best line.", page: 12, workId: w3 });
      const page = renderToStaticMarkup(await YearInReviewPage({ params: Promise.resolve({ year: String(YEAR) }) }));
      expect(page).toContain(`${YEAR} in review`);
      expect(page).toContain(`href="/reading/journal?yearMin=${YEAR}&amp;yearMax=${YEAR}"`);
      expect(page).toContain("The best line.");
    });

    it("finds books finished or started on this calendar day in earlier years, at day precision only", async () => {
      const a = await book("Nadja");
      await past(a, { on: "2019-10-05", rating: 4.5 });
      await past(await book("Watt"), { status: "reading", on: null, startedOn: "2017-10-05" });
      // Month precision, this year and another day: none
      await past(await book("Month"), { on: "2018-10-01", precision: "month" });
      await past(await book("This year"), { on: "2026-10-05" });
      await past(await book("Next day"), { on: "2020-10-06", rating: 3 });
      expect((await onThisDay(["2026-10-05"])).map((h) => [h.day, h.year, h.kind, h.title, h.rating])).toEqual([
        ["2026-10-05", 2019, "finished", "Nadja", 4.5],
        ["2026-10-05", 2017, "started", "Watt", null],
      ]);
      expect((await onThisDay(["2026-10-04", "2026-10-05", "2026-10-06"])).map((h) => h.day)).toEqual(["2026-10-05", "2026-10-05", "2026-10-06"]);
      expect(await onThisDay([])).toEqual([]);
    });
  });
});
