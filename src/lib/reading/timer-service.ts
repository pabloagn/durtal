import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { databaseErrorCode, withReadableErrors } from "@/lib/db/errors";
import { assertSql, resultRows } from "@/lib/harmonization/store";
import { readingSessions, readingStatusHistory, readings } from "@/lib/db/schema";
import { appTimeZone } from "@/lib/utils/date";
import { isOpenStatus } from "./constants";
import { readingDay } from "./dates";
import { readingDayStartHour } from "./day";
import { guardReading, loadReading, loadSessions, recomputeQueries, type Session, type UndoProgress } from "./service";
import { durationWords, elapsedSeconds, TIMER_GONE } from "./timer";

/*
 * The reading timer (SLN-451). The running timer is the one session with
 * source "timer" and no end (`reading_session_timer_unique`). It moves
 * nothing while it runs: the session order, the position, counted pages and
 * pace leave it out. Starting, pausing and resuming touch only its row, so
 * the reading's fingerprint does not change; stopping goes through
 * `recordProgress` with `timerSessionId`.
 */

export interface RunningTimer {
  sessionId: string;
  readingId: string;
  workId: string;
  title: string;
  slug: string | null;
  author: string | null;
  cover: string | null;
  startedAt: string;
  pausedAt: string | null;
  pausedSeconds: number;
  readOn: string;
  timeZone: string;
  status: "reading" | "paused";
  unit: "pages" | "percent" | "minutes";
  format: "print" | "ebook" | "audio";
  editionId: string | null;
  totalPages: number | null;
  totalMinutes: number | null;
  position: { page: number | null; percent: number | null; minutes: number | null };
  fingerprint: string;
}

/** The running timer with its book and its reading's position and fingerprint, or null */
export async function runningTimer(): Promise<RunningTimer | null> {
  const [row] = resultRows<RunningTimer>(
    await db.execute(sql`
      select s.id as "sessionId", r.id as "readingId", w.id as "workId", w.title, w.slug,
        (select a.name from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id order by wa.sort_order, a.name limit 1) as author,
        coalesce((select coalesce(e.thumbnail_s3_key, e.cover_s3_key) from editions e where e.id = r.edition_id),
          (select m.thumbnail_s3_key from media m where m.work_id = w.id and m.type = 'poster' and m.is_active order by m.sort_order limit 1)) as cover,
        to_char(s.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "startedAt",
        case when s.paused_at is null then null else to_char(s.paused_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end as "pausedAt",
        s.paused_seconds as "pausedSeconds", s.read_on::text as "readOn", s.time_zone as "timeZone",
        r.status, r.unit, r.format, r.edition_id as "editionId", r.total_pages as "totalPages", r.total_minutes as "totalMinutes",
        jsonb_build_object('page', r.current_page, 'percent', r.current_percent::float8, 'minutes', r.current_minutes) as position,
        md5(to_jsonb(r)::text) as fingerprint
      from reading_sessions s join readings r on r.id = s.reading_id join works w on w.id = r.work_id
      where s.source = 'timer' and s.ended_at is null
      limit 1`),
  );
  return row ? { ...row, pausedSeconds: Number(row.pausedSeconds) } : null;
}

/** "A timer is running for Nadja. Stop it first" */
export function runningMessage(title: string) {
  return `A timer is running for ${title}. Stop it first`;
}

/** The message when a reading cannot close or be deleted while its timer runs */
export async function refuseWhileTiming(readingId: string) {
  const timer = await runningTimer();
  if (timer && timer.readingId === readingId) throw new Error(`Stop or discard the timer for ${timer.title} first`);
}

/** Starts the timer on an open reading; a paused one resumes first */
export async function startTimerOn(readingId: string, timeZone: string | null | undefined) {
  const reading = await loadReading(readingId);
  if (!reading) throw new Error("This reading no longer exists");
  if (!isOpenStatus(reading.status)) throw new Error("Reopen this reading to time it");
  const running = await runningTimer();
  if (running) throw new Error(runningMessage(running.title));
  const zone = timeZone ?? appTimeZone();
  const now = new Date();
  // The day it started, even when it stops after the day boundary or on a device elsewhere
  const readOn = readingDay(now, zone, await readingDayStartHour());
  const id = randomUUID();
  const resumed = reading.status === "paused";
  try {
    await atomic((d) => [
      ...guardReading(d, reading.id, reading.fingerprint, "This reading changed elsewhere; try again"),
      d.insert(readingSessions).values({
        id,
        readingId: reading.id,
        editionId: reading.editionId,
        format: reading.format,
        readOn,
        timeZone: zone,
        startedAt: now,
        startPage: reading.currentPage,
        startPercent: reading.currentPercent,
        startMinutes: reading.currentMinutes,
        pagesTotal: reading.totalPages,
        source: "timer",
        createdAt: now,
        updatedAt: now,
      }),
      ...(resumed
        ? [
            d.update(readings).set({ status: "reading", updatedAt: now }).where(eq(readings.id, reading.id)),
            d.insert(readingStatusHistory).values({ readingId: reading.id, fromStatus: "paused", toStatus: "reading", notes: "Resumed by the timer" }),
          ]
        : []),
    ]);
  } catch (err) {
    // Another device started one meanwhile: the unique index refused this one
    if (databaseErrorCode(err) === "23505") {
      const other = await runningTimer();
      throw new Error(runningMessage(other?.title ?? "another book"));
    }
    throw err;
  }
  return { sessionId: id, resumed, reading: (await loadReading(reading.id))! };
}

/** The running row, or the message a stopped or discarded timer gives */
async function runningRow(sessionId: string): Promise<Session> {
  const [row] = await db.select().from(readingSessions).where(eq(readingSessions.id, sessionId));
  if (!row || row.source !== "timer" || row.endedAt) throw new Error(TIMER_GONE);
  return row;
}

/** Pauses the timer: pausing a paused timer changes nothing */
export async function pauseTimerRow(sessionId: string) {
  const row = await runningRow(sessionId);
  if (row.pausedAt) return row;
  const [updated] = await db
    .update(readingSessions)
    .set({ pausedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(readingSessions.id, sessionId), isNull(readingSessions.endedAt), isNull(readingSessions.pausedAt)))
    .returning();
  if (!updated) return runningRow(sessionId);
  return updated;
}

/** Resumes the timer: its pause joins the paused time; resuming a running timer changes nothing */
export async function resumeTimerRow(sessionId: string) {
  const row = await runningRow(sessionId);
  if (!row.pausedAt) return row;
  const [updated] = await db
    .update(readingSessions)
    .set({
      pausedSeconds: sql`least(${readingSessions.pausedSeconds} + greatest(0, floor(extract(epoch from (now() - ${readingSessions.pausedAt}))))::int, 86400)`,
      pausedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(readingSessions.id, sessionId), isNull(readingSessions.endedAt), sql`${readingSessions.pausedAt} is not null`))
    .returning();
  if (!updated) return runningRow(sessionId);
  return updated;
}

/** Deletes the running row: the reading's position never moved with it */
export async function discardTimerRow(sessionId: string) {
  const row = await runningRow(sessionId);
  const gone = await db
    .delete(readingSessions)
    .where(and(eq(readingSessions.id, sessionId), isNull(readingSessions.endedAt)))
    .returning({ id: readingSessions.id });
  if (!gone.length) throw new Error(TIMER_GONE);
  return { readingId: row.readingId, seconds: elapsedSeconds({ startedAt: row.startedAt ?? row.createdAt, pausedAt: row.pausedAt, pausedSeconds: row.pausedSeconds }) };
}

/**
 * Undoes a stop: the session runs again (its end cleared, its pause put
 * back), the log a "fix my last log" changed gets its end back, and the
 * position follows the other sessions.
 */
export async function undoStop(sessionId: string, fingerprint: string, undo: UndoProgress) {
  const running = await runningTimer();
  if (running) throw new Error(`A timer is running for ${running.title}`);
  const [row] = await db.select().from(readingSessions).where(eq(readingSessions.id, sessionId));
  if (!row || row.source !== "timer" || !row.endedAt) throw new Error("This timer session no longer exists");
  const reading = await loadReading(row.readingId);
  if (!reading) throw new Error("This reading no longer exists");
  if (reading.fingerprint !== fingerprint) throw new Error("This reading changed elsewhere; reload before saving");
  const sessions = await loadSessions(reading.id);
  const fixedId = undo.timer?.fixedSessionId ?? null;
  const now = new Date();
  const pausedAt = undo.timer?.pausedAt ? new Date(undo.timer.pausedAt) : null;
  const runningAgain: Session = {
    ...row,
    endedAt: null,
    durationSeconds: null,
    endPage: null,
    endPercent: null,
    endMinutes: null,
    endChapter: null,
    pausedAt,
    pausedSeconds: undo.timer?.pausedSeconds ?? 0,
  };
  const remaining = sessions.map((s) => {
    if (s.id === row.id) return runningAgain;
    if (s.id === fixedId && undo.restoreEnd)
      return { ...s, endPage: undo.restoreEnd.page, endPercent: undo.restoreEnd.percent, endMinutes: undo.restoreEnd.minutes, endChapter: undo.restoreEnd.chapter };
    return s;
  });
  const status = undo.repause && reading.status === "reading" ? "paused" : reading.status;
  await withReadableErrors(() =>
    atomic((d) => [
      ...guardReading(d, reading.id, fingerprint),
      d.execute(assertSql(sql`not exists (select 1 from reading_sessions where source = 'timer' and ended_at is null)`, "A timer is running for another book")),
      d
        .update(readingSessions)
        .set({ endedAt: null, durationSeconds: null, endPage: null, endPercent: null, endMinutes: null, endChapter: null, pausedAt, pausedSeconds: runningAgain.pausedSeconds, updatedAt: now })
        .where(eq(readingSessions.id, row.id)),
      ...(fixedId && undo.restoreEnd
        ? [
            d
              .update(readingSessions)
              .set({ endPage: undo.restoreEnd.page, endPercent: undo.restoreEnd.percent, endMinutes: undo.restoreEnd.minutes, endChapter: undo.restoreEnd.chapter, updatedAt: now })
              .where(eq(readingSessions.id, fixedId)),
          ]
        : []),
      ...recomputeQueries(d, { ...reading, status }, remaining, now),
      ...(status !== reading.status
        ? [
            d.update(readings).set({ status, updatedAt: now }).where(eq(readings.id, reading.id)),
            d.insert(readingStatusHistory).values({ readingId: reading.id, fromStatus: reading.status, toStatus: status, notes: "Undo of a timer stop" }),
          ]
        : []),
    ]),
  );
  return (await loadReading(reading.id))!;
}

/** "Discard 42 min of timing for Nadja?" */
export function discardQuestion(seconds: number, title: string) {
  return `Discard ${durationWords(seconds)} of timing for ${title}?`;
}

