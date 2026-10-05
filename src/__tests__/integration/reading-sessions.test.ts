import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_READING_SESSIONS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln451_reading_sessions")
    throw new Error("Reading session tests require a disposable local sln451_reading_sessions database");
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
import {
  abandonReading,
  addSession,
  deleteReading,
  deleteSession,
  discardTimer,
  finishReading,
  getPaceContext,
  getRunningTimer,
  logProgress,
  pauseReading,
  pauseTimer,
  restoreSession,
  resumeTimer,
  startReading,
  startTimer,
  stopTimer,
  undoStopTimer,
} from "@/lib/actions/reading";
import { updateAppSettings } from "@/lib/actions/settings";
import { loadReading } from "@/lib/reading/service";
import { countedPagesSql } from "@/lib/reading/summary";

/* The reading timer and sessions by hand against PostgreSQL (SLN-451). */

describe.skipIf(!url)("reading sessions and the timer with PostgreSQL", () => {
  const dialect = new PgDialect();
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
    await q(`delete from app_settings`);
  });

  let serial = 0;
  async function started(title = "Nadja", pages: number | null = 480) {
    const workId = await value(`insert into works(title, slug) values ($1, $2) returning id`, [title, `${title.toLowerCase()}-${++serial}`]);
    const editionId = await value(`insert into editions(work_id, title, language, page_count) values ($1, $2, 'fr', $3) returning id`, [workId, title, pages]);
    const reading = await startReading({ workId, editionId, startedOn: "2026-09-01", startedPrecision: "day", startPage: 100, timeZone: "Europe/Amsterdam" });
    return { workId, editionId, reading };
  }
  const fp = async (id: string) => (await loadReading(id))!.fingerprint;
  const log = async (readingId: string, input: Record<string, unknown>) =>
    logProgress({ readingId, fingerprint: await fp(readingId), timeZone: "Europe/Amsterdam", ...input } as never);
  /** Moves the running timer's start back, as if it had run that long */
  const backdate = (sessionId: string, minutes: number) =>
    q(`update reading_sessions set started_at = now() - interval '1 minute' * $2::float8 where id = $1`, [sessionId, minutes]);
  const sessionsOf = (readingId: string) =>
    q(`select id, source, start_page, end_page, duration_seconds, ended_at, paused_seconds, read_on::text as read_on, time_zone from reading_sessions where reading_id = $1 order by read_on, coalesce(ended_at, started_at, created_at), created_at`, [readingId]);
  const counted = async (readingId: string) =>
    Number(await value(`select coalesce(round(sum(c.pages)), 0)::int from ${dialect.sqlToQuery(countedPagesSql()).sql} c where c.reading_id = $1`, [readingId]));

  describe("the timer", () => {
    it("runs one at a time across the app: start, pause, resume, stop", async () => {
      const a = await started("Nadja");
      const b = await started("La Curée");
      const { sessionId } = await startTimer({ readingId: a.reading.id, timeZone: "Europe/Amsterdam" });
      await expect(startTimer({ readingId: b.reading.id })).rejects.toThrow("A timer is running for Nadja. Stop it first");
      const paused = await pauseTimer({ sessionId });
      expect(paused?.pausedAt).not.toBeNull();
      expect((await pauseTimer({ sessionId }))?.pausedAt).toBe(paused?.pausedAt);
      await q(`update reading_sessions set paused_at = paused_at - interval '5 minutes' where id = $1`, [sessionId]);
      const resumed = await resumeTimer({ sessionId });
      expect(resumed?.pausedAt).toBeNull();
      expect(resumed!.pausedSeconds).toBeGreaterThanOrEqual(300);
      await backdate(sessionId, 30);
      const stop = await stopTimer({ sessionId, page: 140 });
      expect(stop.session).toMatchObject({ id: sessionId, source: "timer", startPage: 100, endPage: 140 });
      expect(stop.session.durationSeconds!).toBeGreaterThanOrEqual(24 * 60);
      expect(stop.session.durationSeconds!).toBeLessThanOrEqual(26 * 60);
      expect(stop.reading.currentPage).toBe(140);
      expect(await getRunningTimer()).toBeNull();
      await expect(startTimer({ readingId: b.reading.id })).resolves.toMatchObject({ sessionId: expect.any(String) });
    });

    it("stops at an earlier end time, and a paused timer stops at its pause", async () => {
      const a = await started();
      const { sessionId } = await startTimer({ readingId: a.reading.id });
      await backdate(sessionId, 60);
      const endedAt = new Date(Date.now() - 20 * 60_000);
      const stop = await stopTimer({ sessionId, page: 120, endedAt });
      expect(new Date(stop.session.endedAt!).getTime()).toBe(endedAt.getTime());
      expect(Math.round(stop.session.durationSeconds! / 60)).toBe(40);
      const again = await startTimer({ readingId: a.reading.id });
      await backdate(again.sessionId, 30);
      await q(`update reading_sessions set paused_at = now() - interval '10 minutes' where id = $1`, [again.sessionId]);
      const stopped = await stopTimer({ sessionId: again.sessionId, page: 130 });
      expect(Math.round(stopped.session.durationSeconds! / 60)).toBe(20);
    });

    it("refuses a forgotten timer without an end time, and stops it at a chosen time", async () => {
      const a = await started();
      const { sessionId } = await startTimer({ readingId: a.reading.id });
      // Half a minute more: the database's clock and this one may differ by a few seconds
      await backdate(sessionId, 6 * 60 + 12.5);
      await expect(stopTimer({ sessionId, page: 150 })).rejects.toThrow("Your timer for Nadja has run 6 h 12 min. When did you stop?");
      // The end the same half minute after the backdated start: 90 minutes, whatever the clocks
      const stop = await stopTimer({ sessionId, page: 150, endedAt: new Date(Date.now() - (6 * 60 + 12.5 - 90) * 60_000) });
      expect(Math.round(stop.session.durationSeconds! / 60)).toBe(90);
    });

    it("refuses a session over 12 hours", async () => {
      const a = await started();
      const { sessionId } = await startTimer({ readingId: a.reading.id });
      await backdate(sessionId, 13 * 60);
      await expect(stopTimer({ sessionId, endedAt: new Date(Date.now() - 10 * 60_000) })).rejects.toThrow(
        "Edit the end time; a session can be at most 12 hours",
      );
    });

    it("counts a page logged by hand during the timer once", async () => {
      const a = await started();
      const { sessionId } = await startTimer({ readingId: a.reading.id });
      await backdate(sessionId, 40);
      await log(a.reading.id, { page: 130 });
      const stop = await stopTimer({ sessionId, page: 160 });
      expect(stop.session).toMatchObject({ startPage: 130, endPage: 160 });
      expect(await counted(a.reading.id)).toBe(60);
    });

    it("stops below the position: fix my last log, or I went back", async () => {
      const a = await started();
      await log(a.reading.id, { page: 200 });
      const { sessionId } = await startTimer({ readingId: a.reading.id });
      await backdate(sessionId, 20);
      const fixed = await stopTimer({ sessionId, page: 180, goingBack: "fix_last_log" });
      expect(fixed.reading.currentPage).toBe(180);
      const rows = await sessionsOf(a.reading.id);
      expect(rows.map((r) => [r.source, r.start_page, r.end_page])).toEqual([
        ["manual", 100, 180],
        ["timer", 180, 180],
      ]);
      expect(rows[1].duration_seconds).toBeGreaterThan(0);
      const again = await startTimer({ readingId: a.reading.id });
      await backdate(again.sessionId, 20);
      const back = await stopTimer({ sessionId: again.sessionId, page: 150, goingBack: "went_back" });
      expect(back.session).toMatchObject({ startPage: 180, endPage: 150 });
      expect(back.reading.currentPage).toBe(150);
    });

    it("answers a stopped timer's other device", async () => {
      const a = await started();
      const { sessionId } = await startTimer({ readingId: a.reading.id });
      await backdate(sessionId, 10);
      await stopTimer({ sessionId, page: 110 });
      for (const action of [() => pauseTimer({ sessionId }), () => resumeTimer({ sessionId }), () => stopTimer({ sessionId, page: 120 }), () => discardTimer({ sessionId })])
        await expect(action()).rejects.toThrow("This timer was stopped on another device");
    });

    it("discards the running timer and leaves the position alone", async () => {
      const a = await started();
      await log(a.reading.id, { page: 150 });
      const { sessionId } = await startTimer({ readingId: a.reading.id });
      await backdate(sessionId, 42);
      const result = await discardTimer({ sessionId });
      expect(Math.round(result.seconds / 60)).toBe(42);
      expect((await loadReading(a.reading.id))!.currentPage).toBe(150);
      expect((await sessionsOf(a.reading.id)).length).toBe(1);
    });

    it("undoes a stop: the timer runs again and the position follows; refused while another runs", async () => {
      const a = await started();
      const b = await started("La Curée");
      const { sessionId } = await startTimer({ readingId: a.reading.id });
      await backdate(sessionId, 15);
      const stop = await stopTimer({ sessionId, page: 140 });
      const back = await undoStopTimer({ sessionId, fingerprint: stop.reading.fingerprint, undo: stop.undo });
      expect(back.currentPage).toBe(100);
      expect((await getRunningTimer())?.sessionId).toBe(sessionId);
      const stop2 = await stopTimer({ sessionId, page: 145 });
      await startTimer({ readingId: b.reading.id });
      await expect(undoStopTimer({ sessionId, fingerprint: stop2.reading.fingerprint, undo: stop2.undo })).rejects.toThrow("A timer is running for La Curée");
    });

    it("refuses to pause, finish, abandon or delete a reading while its timer runs", async () => {
      const a = await started();
      await startTimer({ readingId: a.reading.id });
      const f = await fp(a.reading.id);
      const message = "Stop or discard the timer for Nadja first";
      await expect(pauseReading({ readingId: a.reading.id, fingerprint: f })).rejects.toThrow(message);
      await expect(finishReading({ readingId: a.reading.id, fingerprint: f })).rejects.toThrow(message);
      await expect(abandonReading({ readingId: a.reading.id, fingerprint: f, reason: "prose" })).rejects.toThrow(message);
      await expect(deleteReading({ readingId: a.reading.id, fingerprint: f })).rejects.toThrow(message);
      // Logging progress during the timer is allowed
      await expect(log(a.reading.id, { page: 120 })).resolves.toBeTruthy();
    });

    it("keeps the start day and zone: 23:50 Amsterdam stopped at 00:40, 21:30 Mexico City", async () => {
      const a = await started();
      const { sessionId } = await startTimer({ readingId: a.reading.id, timeZone: "Europe/Amsterdam" });
      // Started at 23:50 Amsterdam on 3 Oct, 50 minutes ago in this test's clock
      await q(`update reading_sessions set started_at = (timestamp '2026-10-03 23:50' at time zone 'Europe/Amsterdam'), read_on = '2026-10-03' where id = $1`, [sessionId]);
      const stop = await stopTimer({ sessionId, page: 110, endedAt: new Date("2026-10-03T22:40:00Z") });
      expect(stop.session).toMatchObject({ readOn: "2026-10-03", timeZone: "Europe/Amsterdam" });
      // A start at 21:30 in Mexico City is that local day, with its zone
      const b = await started("La Curée");
      const t = await startTimer({ readingId: b.reading.id, timeZone: "America/Mexico_City" });
      const row = (await q(`select time_zone, read_on::text as read_on from reading_sessions where id = $1`, [t.sessionId]))[0];
      expect(row.time_zone).toBe("America/Mexico_City");
      const local = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
        .formatToParts(new Date());
      const part = (t2: string) => local.find((p) => p.type === t2)!.value;
      const expected = Number(part("hour")) < 4 ? new Date(Date.UTC(+part("year"), +part("month") - 1, +part("day") - 1)).toISOString().slice(0, 10) : `${part("year")}-${part("month")}-${part("day")}`;
      expect(row.read_on).toBe(expected);
    });

    it("gives the running timer with its reading's fingerprint", async () => {
      const a = await started();
      const { sessionId } = await startTimer({ readingId: a.reading.id });
      const running = await getRunningTimer();
      expect(running).toMatchObject({ sessionId, readingId: a.reading.id, title: "Nadja", pausedSeconds: 0, position: { page: 100 } });
      expect(running!.fingerprint).toBe(await fp(a.reading.id));
    });
  });

  describe("sessions by hand", () => {
    it("puts a backdated session in its place and leaves the position; a newest one moves it", async () => {
      const a = await started();
      await log(a.reading.id, { page: 150, readOn: "2026-09-10" });
      await log(a.reading.id, { page: 200, readOn: "2026-09-20" });
      const back = await addSession({ readingId: a.reading.id, fingerprint: await fp(a.reading.id), readOn: "2026-09-15", to: { page: 170 }, durationSeconds: 1800, timeZone: "Europe/Amsterdam" });
      expect(back.reading.currentPage).toBe(200);
      expect((await sessionsOf(a.reading.id)).map((r) => [r.read_on, r.start_page, r.end_page])).toEqual([
        ["2026-09-10", 100, 150],
        ["2026-09-15", 150, 170],
        ["2026-09-20", 170, 200],
      ]);
      const newest = await addSession({ readingId: a.reading.id, fingerprint: await fp(a.reading.id), readOn: "2026-09-25", to: { page: 230 }, timeZone: "Europe/Amsterdam" });
      expect(newest.reading.currentPage).toBe(230);
      await expect(
        addSession({ readingId: a.reading.id, fingerprint: await fp(a.reading.id), readOn: "2026-09-26", to: { page: 240 }, startedAt: new Date("2026-09-28T12:00:00Z"), timeZone: "Europe/Amsterdam" }),
      ).rejects.toThrow("The start and end times must fall on the session's day");
    });

    it("deletes a session and restores the same row and position", async () => {
      const a = await started();
      await log(a.reading.id, { page: 150, readOn: "2026-09-10" });
      const second = await log(a.reading.id, { page: 200, readOn: "2026-09-20" });
      const before = (await sessionsOf(a.reading.id)).map((r) => ({ ...r }));
      const { reading, session } = await deleteSession({ sessionId: second.session.id, fingerprint: await fp(a.reading.id) });
      expect(reading.currentPage).toBe(150);
      const restored = await restoreSession({ readingId: a.reading.id, fingerprint: reading.fingerprint, snapshot: JSON.parse(JSON.stringify(session)) });
      expect(restored.currentPage).toBe(200);
      expect((await sessionsOf(a.reading.id)).map((r) => ({ ...r }))).toEqual(before);
    });
  });

  describe("pace", () => {
    it("counts pages with countedPagesSql, leaves out the running timer and closing sessions, gives numbers", async () => {
      const workId = await value(`insert into works(title, slug) values ('Zero', 'zero-${++serial}') returning id`);
      const editionId = await value(`insert into editions(work_id, title, language, page_count) values ($1, 'Zero', 'fr', 480) returning id`, [workId]);
      const r = await startReading({ workId, editionId, startedOn: "2026-09-01", startedPrecision: "day", timeZone: "Europe/Amsterdam" });
      // p. 400 by mistake, then p. 212 the same day: the last log is corrected
      await log(r.id, { page: 400, readOn: "2026-09-02", durationSeconds: 3600 });
      await log(r.id, { page: 212, readOn: "2026-09-02" });
      const { sessionId } = await startTimer({ readingId: r.id });
      await backdate(sessionId, 30);
      const ctx = await getPaceContext([r.id]);
      const pace = ctx.readings[r.id];
      // countedPagesSql counts by share of the page total: 212 pages, give or take a rounding of the percent
      expect(pace.sessions.map((x) => [x.readOn, Math.round(x.pages), x.durationSeconds])).toEqual([["2026-09-02", 212, 3600]]);
      expect(typeof pace.currentPercent).toBe("number");
      expect(pace).toMatchObject({ format: "print", unit: "pages", language: "fr", totalPages: 480 });
      await discardTimer({ sessionId });
      // A finish writes a closing session without a duration: it counts pages but no time
      await finishReading({ readingId: r.id, fingerprint: await fp(r.id) });
      const after = await getPaceContext([r.id]);
      expect(after.readings[r.id].sessions.filter((x) => x.durationSeconds).length).toBe(1);
    });

    it("gives his priors by language and format, by format and overall, also with no reading", async () => {
      const fr = await started("Nadja");
      await log(fr.reading.id, { page: 160, readOn: "2026-09-02", durationSeconds: 7200 });
      const enWork = await value(`insert into works(title, slug) values ('Watt', 'watt-${++serial}') returning id`);
      const enEdition = await value(`insert into editions(work_id, title, language, page_count) values ($1, 'Watt', 'en', 300) returning id`, [enWork]);
      const en = await startReading({ workId: enWork, editionId: enEdition, startedOn: "2026-09-01", startedPrecision: "day", timeZone: "Europe/Amsterdam" });
      await log(en.id, { page: 120, readOn: "2026-09-03", durationSeconds: 3600 });
      const { priors } = await getPaceContext([]);
      expect(priors.byLanguageFormat["fr|print"]).toBeCloseTo(30, 1);
      expect(priors.byLanguageFormat["en|print"]).toBeCloseTo(120, 1);
      expect(priors.byFormat.print).toBeCloseTo(60, 1);
      expect(priors.overall).toBeCloseTo(60, 1);
    });
  });

  describe("settings", () => {
    it("leaves stored reading days alone when the day start hour changes", async () => {
      const a = await started();
      await log(a.reading.id, { page: 150, readOn: "2026-09-10" });
      expect(await updateAppSettings({ readingDayStartHour: 0 })).toMatchObject({ ok: true });
      expect((await sessionsOf(a.reading.id)).map((r) => r.read_on)).toEqual(["2026-09-10"]);
    });

    it("refuses an hour of 7, a week starting on Wednesday and a check of 10 minutes", async () => {
      await q(`insert into app_settings(id) values (true) on conflict do nothing`);
      for (const [column, v, constraint] of [
        ["reading_day_start_hour", 7, "app_settings_reading_day_start_hour_check"],
        ["reading_week_start", 3, "app_settings_reading_week_start_check"],
        ["reading_timer_check_minutes", 10, "app_settings_reading_timer_check_minutes_check"],
      ] as const)
        await expect(q(`update app_settings set ${column} = $1`, [v])).rejects.toMatchObject({ constraint_name: constraint });
      expect(await updateAppSettings({ readingDayStartHour: 7 })).toMatchObject({ ok: false });
    });
  });
});
