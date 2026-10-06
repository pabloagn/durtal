"use server";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { assertSql, resultRows } from "@/lib/harmonization/store";
import {
  editions,
  instances,
  locations,
  readingSessions,
  readingStatusHistory,
  readings,
  works,
  readingNotes,
} from "@/lib/db/schema";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { recordActivity } from "@/lib/activity/record";
import { requireBookWork } from "@/lib/catalogue/book-boundary";
import { appTimeZone } from "@/lib/utils/date";
import { PAGE_SIZES } from "@/lib/utils/pagination";
import { sanitizeCommentHtml } from "@/lib/utils/sanitize";
import { isOpenStatus, type ReadingFormat, type ReadingStatus } from "@/lib/reading/constants";
import { formatReadingDate, readingDay, readingPeriodStart } from "@/lib/reading/dates";
import { readingDayStartHour, readingToday } from "@/lib/reading/day";
import { percentOf, remapPosition } from "@/lib/reading/positions";
import { countedPagesSql, readingOrdinalSql } from "@/lib/reading/summary";
import { progressEvent, readingEvent } from "@/lib/reading/activity";
import type { PacePriors, PaceReading, PaceSession } from "@/lib/reading/pace";
import { TIMER_GONE } from "@/lib/reading/timer";
import { overlapMessage, overlappingSession, sessionSpan, type TimedSession } from "@/lib/reading/session-overlap";
import {
  discardTimerRow,
  pauseTimerRow,
  refuseWhileTiming,
  resumeTimerRow,
  runningTimer,
  startTimerOn,
  undoStop,
} from "@/lib/reading/timer-service";
import {
  FUTURE_SESSION,
  STALE_READING,
  checkWithinTotals,
  completePosition,
  createReading,
  editionPages,
  guardReading,
  isRunningTimer,
  loadReading,
  loadSessions,
  openReadingMessage,
  openReadingOf,
  positionValues,
  recomputeQueries,
  recordProgress,
  sessionOrder,
  writeReadings,
  type Reading,
  type Session,
} from "@/lib/reading/service";
import {
  abandonReadingSchema,
  addPastReadingSchema,
  addSessionSchema,
  deleteSessionSchema,
  finishReadingSchema,
  logProgressSchema,
  reopenReadingSchema,
  sessionPatchSchema,
  restoreSessionSchema,
  startReadingSchema,
  startTimerSchema,
  statusChangeSchema,
  stopTimerSchema,
  timerSessionSchema,
  undoProgressSchema,
  undoStopTimerSchema,
  updateReadingSchema,
  type AddPastReadingInput,
  type LogProgressInput,
  type SessionPatchInput,
  type StopTimerInput,
  type AddSessionInput,
  type StartReadingInput,
  type UpdateReadingInput,
} from "@/lib/validations/reading";

/*
 * The reading tracker's page actions (SLN-444). Each write parses its input,
 * checks the book, reads the reading and its fingerprint, then runs one atomic
 * batch that locks the reading and asserts the fingerprint. Every write
 * returns the reading with its new fingerprint.
 */

function changed() {
  invalidate(CACHE_TAGS.works, CACHE_TAGS.reading);
}

/** A reading checked against the fingerprint the page holds */
async function readingFor(readingId: string, fingerprint: string) {
  const reading = await loadReading(readingId);
  if (!reading) throw new Error("This reading no longer exists");
  if (reading.fingerprint !== fingerprint) throw new Error(STALE_READING);
  return reading;
}

const event = readingEvent;

/** The edition's title, for the history entries */
async function editionTitle(editionId: string | null) {
  if (!editionId) return null;
  const [row] = await db.select({ title: editions.title }).from(editions).where(eq(editions.id, editionId));
  return row?.title ?? null;
}

const statusHistory = (readingId: string, fromStatus: ReadingStatus | null, toStatus: ReadingStatus, notes: string | null = null) => ({
  readingId,
  fromStatus,
  toStatus,
  notes,
});

/** Starts reading a book: its copy, edition, home, format and start */
export async function startReading(input: StartReadingInput) {
  const data = startReadingSchema.parse(input);
  await requireBookWork(data.workId);
  const reading = await createReading(data, { source: "manual" });
  event(data.workId, "work.reading_started", reading, {
    editionTitle: await editionTitle(reading.editionId),
    percent: reading.currentPercent,
  });
  changed();
  return reading;
}

/**
 * Logs progress. A paused reading resumes first. Going back follows the
 * dialog's choice: fix the last log, or a new session that went back.
 */
export async function logProgress(input: LogProgressInput) {
  const data = logProgressSchema.parse(input);
  // A timer stops through stopTimer only
  const { fingerprint, editionId, format, timerSessionId: _timer, ...progress } = data;
  const before = await loadReading(data.readingId);
  if (!before) throw new Error("This reading no longer exists");
  await requireBookWork(before.workId);
  const result = await recordProgress(progress, { fingerprint, source: "manual", editionId, format });
  if (result.resumed) event(before.workId, "work.reading_resumed", result.reading);
  await progressEvent(result.reading, result.session.readOn);
  changed();
  return result;
}

/* ── Pace (SLN-451) ── */

export interface PaceContext {
  readings: Record<string, PaceReading>;
  priors: PacePriors;
}

/**
 * Everything the estimates need for these readings, in one query: their
 * ended sessions with countedPagesSql pages (the running timer left out),
 * their paused intervals, and his priors over the last two years by
 * language and format, by format and overall. `getPaceContext([])` gives
 * the priors alone. Computed per request, never cached.
 */
export async function getPaceContext(readingIds: string[]): Promise<PaceContext> {
  const ids = z.array(z.uuid()).max(500).parse(readingIds);
  const zone = appTimeZone();
  const [row] = resultRows<{
    data: {
      readings: (Omit<PaceReading, "sessions" | "pauses"> & { readingId: string })[] | null;
      sessions: (PaceSession & { readingId: string })[] | null;
      pauses: { readingId: string; from: string; to: string | null }[] | null;
      priors: { language: string | null; format: ReadingFormat | null; level: number; pages: number; hours: number }[] | null;
    };
  }>(
    await db.execute(sql`
      with ids as (select value::uuid as id from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)),
      counted as (select c.session_id, c.pages from ${countedPagesSql()} c where c.session_id is not null),
      priors as (
        select e.language, s.format, grouping(e.language, s.format)::int as level,
          sum(c.pages)::float8 as pages, (sum(s.duration_seconds) / 3600.0)::float8 as hours
        from reading_sessions s
        join counted c on c.session_id = s.id
        left join editions e on e.id = s.edition_id
        where s.duration_seconds > 0 and c.pages > 0 and s.format in ('print', 'ebook')
          and s.read_on >= (current_date - interval '2 years')
        group by grouping sets ((e.language, s.format), (s.format), ())
      )
      select jsonb_build_object(
        'readings', (select jsonb_agg(jsonb_build_object(
            'readingId', r.id, 'format', r.format, 'unit', r.unit, 'language', e.language,
            'totalPages', r.total_pages, 'totalMinutes', r.total_minutes,
            'currentPercent', r.current_percent::float8, 'currentMinutes', r.current_minutes))
          from readings r left join editions e on e.id = r.edition_id where r.id in (select id from ids)),
        'sessions', (select jsonb_agg(jsonb_build_object(
            'readingId', s.reading_id, 'readOn', s.read_on::text, 'durationSeconds', s.duration_seconds, 'format', s.format,
            'pages', coalesce(c.pages, 0)::float8,
            'minutesAdvanced', case when s.end_minutes > coalesce(s.start_minutes, 0) then s.end_minutes - coalesce(s.start_minutes, 0) end)
            order by s.read_on)
          from reading_sessions s left join counted c on c.session_id = s.id
          where s.reading_id in (select id from ids) and not (s.source = 'timer' and s.ended_at is null)),
        'pauses', (select jsonb_agg(jsonb_build_object('readingId', p.reading_id, 'from', p.from_day, 'to', p.to_day))
          from (select h.reading_id, h.to_status, (h.changed_at at time zone ${zone})::date::text as from_day,
              (lead(h.changed_at) over (partition by h.reading_id order by h.changed_at) at time zone ${zone})::date::text as to_day
            from reading_status_history h where h.reading_id in (select id from ids)) p
          where p.to_status = 'paused'),
        'priors', (select jsonb_agg(jsonb_build_object('language', language, 'format', format, 'level', level, 'pages', pages, 'hours', hours)) from priors)
      ) as data`),
  );
  const data = row?.data ?? { readings: null, sessions: null, pauses: null, priors: null };
  const priors: PacePriors = { byLanguageFormat: {}, byFormat: {}, overall: null };
  for (const p of data.priors ?? []) {
    if (!p.hours) continue;
    const pace = p.pages / p.hours;
    if (p.level === 0 && p.language && p.format) priors.byLanguageFormat[`${p.language}|${p.format}`] = pace;
    else if (p.level === 2 && p.format) priors.byFormat[p.format] = pace;
    else if (p.level === 3) priors.overall = pace;
  }
  const readings: Record<string, PaceReading> = {};
  for (const r of data.readings ?? []) readings[r.readingId] = { ...r, sessions: [], pauses: [] };
  for (const { readingId, ...session } of data.sessions ?? []) readings[readingId]?.sessions.push(session);
  for (const { readingId, ...pause } of data.pauses ?? []) readings[readingId]?.pauses.push(pause);
  return { readings, priors };
}

/* ── The reading timer (SLN-451) ── */

/** The running timer with its book, position and fingerprint, or null: the chip loads it after mount */
export async function getRunningTimer() {
  return runningTimer();
}

/** Starts the one timer on an open reading; a paused reading resumes first */
export async function startTimer(input: z.input<typeof startTimerSchema>) {
  const data = startTimerSchema.parse(input);
  const reading = await loadReading(data.readingId);
  if (!reading) throw new Error("This reading no longer exists");
  await requireBookWork(reading.workId);
  const result = await startTimerOn(reading.id, data.timeZone);
  if (result.resumed) event(reading.workId, "work.reading_resumed", result.reading);
  changed();
  return { sessionId: result.sessionId, reading: result.reading };
}

/** Pauses the timer; pausing a paused one changes nothing */
export async function pauseTimer(input: z.input<typeof timerSessionSchema>) {
  await pauseTimerRow(timerSessionSchema.parse(input).sessionId);
  return runningTimer();
}

/** Resumes the timer; its pause joins the paused time */
export async function resumeTimer(input: z.input<typeof timerSessionSchema>) {
  await resumeTimerRow(timerSessionSchema.parse(input).sessionId);
  return runningTimer();
}

/**
 * Stops the timer: its running row completes with the end given (or where it
 * started), at `endedAt` or now, through the progress writer, which reads the
 * reading fresh and retries once. A forgotten timer needs `endedAt`.
 */
export async function stopTimer(input: StopTimerInput) {
  const { sessionId, editionId, format, ...rest } = stopTimerSchema.parse(input);
  const [row] = await db.select({ readingId: readingSessions.readingId }).from(readingSessions).where(eq(readingSessions.id, sessionId));
  if (!row) throw new Error(TIMER_GONE);
  const before = await loadReading(row.readingId);
  if (!before) throw new Error("This reading no longer exists");
  await requireBookWork(before.workId);
  const result = await recordProgress({ readingId: row.readingId, ...rest, timerSessionId: sessionId }, { source: "timer", editionId, format });
  if (result.resumed) event(before.workId, "work.reading_resumed", result.reading);
  await progressEvent(result.reading, result.session.readOn);
  changed();
  return result;
}

/** The 10-second Undo of a stop: the timer runs again and the position follows the other sessions */
export async function undoStopTimer(input: z.input<typeof undoStopTimerSchema>) {
  const data = undoStopTimerSchema.parse(input);
  const end = data.undo.restoreEnd;
  const reading = await undoStop(data.sessionId, data.fingerprint, {
    ...data.undo,
    restoreEnd: end ? { page: end.page ?? null, percent: end.percent ?? null, minutes: end.minutes ?? null, chapter: end.chapter ?? null } : null,
  });
  changed();
  return reading;
}

/** Deletes the running timer after the page asked; the position does not change */
export async function discardTimer(input: z.input<typeof timerSessionSchema>) {
  const result = await discardTimerRow(timerSessionSchema.parse(input).sessionId);
  changed();
  return result;
}

/** Undoes a progress save: deletes the session it wrote or puts back the end it replaced */
export async function undoProgress(input: z.input<typeof undoProgressSchema>) {
  const { readingId, fingerprint, undo } = undoProgressSchema.parse(input);
  const reading = await readingFor(readingId, fingerprint);
  const sessions = await loadSessions(reading.id);
  const target = sessions.find((s) => s.id === undo.sessionId);
  if (!target) throw new Error("This log no longer exists");
  const now = new Date();
  const remaining: Session[] = undo.restoreEnd
    ? sessions.map((s) =>
        s.id === target.id
          ? {
              ...s,
              endPage: undo.restoreEnd!.page ?? null,
              endPercent: undo.restoreEnd!.percent ?? null,
              endMinutes: undo.restoreEnd!.minutes ?? null,
              endChapter: undo.restoreEnd!.chapter ?? null,
            }
          : s,
      )
    : sessions.filter((s) => s.id !== target.id);
  const status: ReadingStatus = undo.repause && reading.status === "reading" ? "paused" : reading.status;
  await withReadableErrors(() =>
    atomic((d) => [
      ...guardReading(d, reading.id, fingerprint),
      undo.restoreEnd
        ? d
            .update(readingSessions)
            .set({
              endPage: undo.restoreEnd.page ?? null,
              endPercent: undo.restoreEnd.percent ?? null,
              endMinutes: undo.restoreEnd.minutes ?? null,
              endChapter: undo.restoreEnd.chapter ?? null,
              updatedAt: now,
            })
            .where(eq(readingSessions.id, target.id))
        : d.delete(readingSessions).where(eq(readingSessions.id, target.id)),
      ...recomputeQueries(d, { ...reading, status }, remaining, now),
      ...(status !== reading.status
        ? [
            d.update(readings).set({ status, updatedAt: now }).where(eq(readings.id, reading.id)),
            d.insert(readingStatusHistory).values(statusHistory(reading.id, reading.status, status, "Undo of a progress log")),
          ]
        : []),
    ]),
  );
  changed();
  return (await loadReading(reading.id))!;
}

async function changeStatus(readingId: string, fingerprint: string, from: ReadingStatus[], to: ReadingStatus, eventKey: string) {
  const reading = await readingFor(readingId, fingerprint);
  await requireBookWork(reading.workId);
  if (!from.includes(reading.status)) throw new Error(`This reading is ${reading.status}`);
  const now = new Date();
  await withReadableErrors(() =>
    atomic((d) => [
      ...guardReading(d, reading.id, fingerprint),
      d.update(readings).set({ status: to, updatedAt: now }).where(eq(readings.id, reading.id)),
      d.insert(readingStatusHistory).values(statusHistory(reading.id, reading.status, to)),
    ]),
  );
  const fresh = (await loadReading(reading.id))!;
  event(reading.workId, eventKey, fresh);
  changed();
  return fresh;
}

export async function pauseReading(input: z.input<typeof statusChangeSchema>) {
  const { readingId, fingerprint } = statusChangeSchema.parse(input);
  await refuseWhileTiming(readingId);
  return changeStatus(readingId, fingerprint, ["reading"], "paused", "work.reading_paused");
}

export async function resumeReading(input: z.input<typeof statusChangeSchema>) {
  const { readingId, fingerprint } = statusChangeSchema.parse(input);
  return changeStatus(readingId, fingerprint, ["paused"], "reading", "work.reading_resumed");
}

/**
 * A closing session from the current position to the end, when the end is
 * ahead and the reading already has sessions: the pages between count on
 * the finish day (or the latest session's day for an imprecise finish).
 */
function closingSession(reading: Reading, sessions: Session[], end: { page: number | null; percent: number | null; minutes: number | null }, day: string | null) {
  const ordered = sessionOrder(sessions);
  const latest = ordered.at(-1);
  if (!latest) return null;
  if ((end.percent ?? 0) <= (reading.currentPercent ?? 0)) return null;
  const now = new Date();
  return {
    id: randomUUID(),
    readingId: reading.id,
    editionId: reading.editionId,
    format: reading.format,
    readOn: day ?? latest.readOn,
    timeZone: latest.timeZone,
    startPage: reading.currentPage,
    startPercent: reading.currentPercent,
    startMinutes: reading.currentMinutes,
    endPage: end.page,
    endPercent: end.percent,
    endMinutes: end.minutes,
    pagesTotal: reading.totalPages,
    source: "manual" as const,
    createdAt: now,
    updatedAt: now,
  };
}

/** Finishes a reading: the end, the date, a rating and review, and the book's rating */
export async function finishReading(input: z.input<typeof finishReadingSchema>) {
  const data = finishReadingSchema.parse(input);
  await refuseWhileTiming(data.readingId);
  const reading = await readingFor(data.readingId, data.fingerprint);
  await requireBookWork(reading.workId);
  if (!isOpenStatus(reading.status)) throw new Error("Only an open reading can be finished");
  const timeZone = data.timeZone ?? appTimeZone();
  const precision = data.finishedPrecision ?? "day";
  const finishedOn =
    precision === "unknown" ? null : readingPeriodStart(data.finishedOn ?? readingDay(new Date(), timeZone, await readingDayStartHour()), precision);
  const end = {
    page: reading.totalPages ?? reading.currentPage,
    percent: 100,
    minutes: reading.totalMinutes ?? reading.currentMinutes,
  };
  const sessions = await loadSessions(reading.id);
  const closing = closingSession(reading, sessions, end, precision === "day" ? finishedOn : null);
  const setBook = data.rating != null && data.setBookRating !== false;
  const [work] = await db.select({ rating: works.rating }).from(works).where(eq(works.id, reading.workId));
  const restoreBookRating = setBook && work.rating !== data.rating ? { before: work.rating, after: data.rating! } : null;
  const now = new Date();
  await withReadableErrors(() =>
    atomic((d) => [
      ...guardReading(d, reading.id, data.fingerprint),
      ...(closing ? [d.insert(readingSessions).values(closing)] : []),
      d
        .update(readings)
        .set({
          status: "finished",
          finishedOn,
          finishedPrecision: finishedOn ? precision : "unknown",
          ...positionValues({ ...end, chapter: reading.currentChapter }),
          ...(data.rating !== undefined ? { rating: data.rating } : {}),
          ...(data.reviewHtml !== undefined ? { reviewHtml: data.reviewHtml ? sanitizeCommentHtml(data.reviewHtml) : null } : {}),
          ...(data.reviewJson !== undefined ? { reviewJson: data.reviewJson ?? null } : {}),
          lastReadAt: closing ? now : reading.lastReadAt,
          updatedAt: now,
        })
        .where(eq(readings.id, reading.id)),
      d.insert(readingStatusHistory).values(statusHistory(reading.id, reading.status, "finished")),
      ...(restoreBookRating ? [d.update(works).set({ rating: data.rating!, updatedAt: now }).where(eq(works.id, reading.workId))] : []),
    ]),
  );
  const fresh = (await loadReading(reading.id))!;
  event(reading.workId, "work.reading_finished", fresh, { rating: data.rating ?? null });
  if (restoreBookRating)
    recordActivity("work", reading.workId, "work.rating_changed", { oldValue: restoreBookRating.before, newValue: restoreBookRating.after });
  changed();
  return {
    reading: fresh,
    undo: {
      toStatus: reading.status as "reading" | "paused",
      position: { page: reading.currentPage, percent: reading.currentPercent, minutes: reading.currentMinutes, chapter: reading.currentChapter },
      closingSessionId: closing?.id ?? null,
      restoreBookRating,
    },
  };
}

/** Abandons a reading: when, why, and the page reached */
export async function abandonReading(input: z.input<typeof abandonReadingSchema>) {
  const data = abandonReadingSchema.parse(input);
  await refuseWhileTiming(data.readingId);
  const reading = await readingFor(data.readingId, data.fingerprint);
  await requireBookWork(reading.workId);
  if (!isOpenStatus(reading.status)) throw new Error("Only an open reading can be abandoned");
  const timeZone = data.timeZone ?? appTimeZone();
  const precision = data.stoppedPrecision ?? "day";
  const stoppedOn =
    precision === "unknown" ? null : readingPeriodStart(data.stoppedOn ?? readingDay(new Date(), timeZone, await readingDayStartHour()), precision);
  const given = { page: data.page, percent: data.percent, minutes: data.minutes };
  const reached = [given.page, given.percent, given.minutes].some((v) => v != null);
  if (reached) checkWithinTotals(given, reading);
  const end = reached
    ? completePosition(given, reading)
    : { page: reading.currentPage, percent: reading.currentPercent, minutes: reading.currentMinutes };
  const sessions = await loadSessions(reading.id);
  const closing = reached ? closingSession(reading, sessions, end, precision === "day" ? stoppedOn : null) : null;
  const now = new Date();
  await withReadableErrors(() =>
    atomic((d) => [
      ...guardReading(d, reading.id, data.fingerprint),
      ...(closing ? [d.insert(readingSessions).values(closing)] : []),
      d
        .update(readings)
        .set({
          status: "abandoned",
          finishedOn: stoppedOn,
          finishedPrecision: stoppedOn ? precision : "unknown",
          ...positionValues({ ...end, chapter: reading.currentChapter }),
          abandonReason: data.reason,
          abandonNote: data.note ?? null,
          lastReadAt: closing ? now : reading.lastReadAt,
          updatedAt: now,
        })
        .where(eq(readings.id, reading.id)),
      d.insert(readingStatusHistory).values(statusHistory(reading.id, reading.status, "abandoned")),
    ]),
  );
  const fresh = (await loadReading(reading.id))!;
  event(reading.workId, "work.reading_abandoned", fresh, { reason: data.reason });
  changed();
  return {
    reading: fresh,
    undo: {
      toStatus: reading.status as "reading" | "paused",
      position: { page: reading.currentPage, percent: reading.currentPercent, minutes: reading.currentMinutes, chapter: reading.currentChapter },
      closingSessionId: closing?.id ?? null,
      restoreBookRating: null,
    },
  };
}

/**
 * Finished or abandoned back to open: "not finished after all", resume an
 * abandoned read, or the Undo of finish and abandon. The book's rating goes
 * back only while it still has the value the finish set.
 */
export async function reopenReading(input: z.input<typeof reopenReadingSchema>) {
  const data = reopenReadingSchema.parse(input);
  const reading = await readingFor(data.readingId, data.fingerprint);
  await requireBookWork(reading.workId);
  if (isOpenStatus(reading.status)) throw new Error("This reading is already open");
  const open = await openReadingOf(reading.workId);
  if (open) throw new Error(openReadingMessage(open.status));
  const toStatus = data.toStatus ?? "reading";
  const restore = data.restoreBookRating ?? null;
  let ratingMessage: string | null = null;
  if (restore) {
    const [work] = await db.select({ rating: works.rating }).from(works).where(eq(works.id, reading.workId));
    if (work.rating !== restore.after) ratingMessage = "The book's rating was changed since; it was kept";
  }
  const now = new Date();
  await withReadableErrors(() =>
    atomic((d) => [
      ...guardReading(d, reading.id, data.fingerprint),
      ...(data.closingSessionId
        ? [d.delete(readingSessions).where(and(eq(readingSessions.id, data.closingSessionId), eq(readingSessions.readingId, reading.id)))]
        : []),
      d
        .update(readings)
        .set({
          status: toStatus,
          finishedOn: null,
          finishedPrecision: "unknown",
          abandonReason: null,
          abandonNote: null,
          ...(data.position
            ? positionValues({
                page: data.position.page ?? null,
                percent: data.position.percent ?? null,
                minutes: data.position.minutes ?? null,
                chapter: data.position.chapter ?? null,
              })
            : {}),
          updatedAt: now,
        })
        .where(eq(readings.id, reading.id)),
      d.insert(readingStatusHistory).values(statusHistory(reading.id, reading.status, toStatus, "Reopened")),
      ...(restore && !ratingMessage
        ? [
            d.execute(
              assertSql(
                sql`(select rating from works where id = ${reading.workId}::uuid) is not distinct from ${restore.after}::numeric`,
                "The book's rating was changed since; reload before undoing",
              ),
            ),
            d.update(works).set({ rating: restore.before, updatedAt: now }).where(eq(works.id, reading.workId)),
          ]
        : []),
    ]),
  );
  const fresh = (await loadReading(reading.id))!;
  event(reading.workId, toStatus === "paused" ? "work.reading_paused" : "work.reading_resumed", fresh);
  if (restore && !ratingMessage)
    recordActivity("work", reading.workId, "work.rating_changed", { oldValue: restore.after, newValue: restore.before });
  changed();
  return { reading: fresh, message: ratingMessage };
}

/** A read from the past, written in one step; a duplicate is named, not written */
export async function addPastReading(input: AddPastReadingInput) {
  const data = addPastReadingSchema.parse(input);
  await requireBookWork(data.workId);
  const [outcome] = await writeReadings(
    [
      {
        workId: data.workId,
        editionId: data.editionId,
        instanceId: data.instanceId,
        locationId: data.locationId,
        format: data.format,
        unit: data.unit,
        totalPages: data.totalPages,
        status: data.status,
        startedOn: data.startedOn,
        startedPrecision: data.startedPrecision,
        finishedOn: data.finishedOn,
        finishedPrecision: data.finishedPrecision,
        rating: data.rating,
        reviewHtml: data.reviewHtml,
        reviewJson: data.reviewJson,
        abandonReason: data.status === "abandoned" ? (data.reason ?? null) : null,
        abandonNote: data.status === "abandoned" ? (data.note ?? null) : null,
        position: data.page != null ? { page: data.page } : null,
        bookRating: "if_none",
        allowPossibleDuplicate: data.allowPossibleDuplicate,
      },
    ],
    { source: "manual" },
  );
  if (outcome.outcome === "refused") throw new Error(outcome.reason ?? "This read could not be saved");
  if (outcome.outcome === "written") {
    const reading = (await loadReading(outcome.readingId!))!;
    event(data.workId, data.status === "finished" ? "work.reading_finished" : "work.reading_abandoned", reading, {
      rating: data.rating ?? null,
      past: true,
    });
    if (outcome.bookRating && outcome.bookRating.after !== outcome.bookRating.before)
      recordActivity("work", data.workId, "work.rating_changed", { oldValue: outcome.bookRating.before, newValue: outcome.bookRating.after });
    changed();
    return { outcome: "written" as const, reading };
  }
  const match = outcome.match ? await loadReading(outcome.match.readingId) : null;
  const when = match ? formatReadingDate(match.finishedOn, match.finishedPrecision) : null;
  return {
    outcome: outcome.outcome,
    reading: match,
    message:
      outcome.outcome === "already_present"
        ? `You already logged this read${when && match?.finishedOn ? `: ${match.status === "abandoned" ? "stopped" : "finished"} ${when}` : ""}`
        : "This may be a read you already logged",
  };
}

/** Edits a reading: edition or copy (the place is mapped), format, home, totals, dates, rating, review */
export async function updateReading(input: UpdateReadingInput) {
  const { readingId, fingerprint, ...patch } = updateReadingSchema.parse(input);
  const reading = await readingFor(readingId, fingerprint);
  await requireBookWork(reading.workId);
  const values: Partial<typeof readings.$inferInsert> = {};
  let editionChanged = false;
  let totals = { totalPages: reading.totalPages, totalMinutes: reading.totalMinutes };
  let editionId = reading.editionId;
  if (patch.instanceId !== undefined) {
    values.instanceId = patch.instanceId;
    if (patch.instanceId && patch.editionId === undefined) {
      const [copy] = await db.select({ editionId: instances.editionId }).from(instances).where(eq(instances.id, patch.instanceId));
      if (!copy) throw new Error("This copy no longer exists");
      editionId = copy.editionId;
    }
  }
  if (patch.editionId !== undefined) editionId = patch.editionId;
  if (editionId !== reading.editionId) {
    const edition = await editionPages(editionId);
    if (editionId && (!edition || edition.workId !== reading.workId)) throw new Error("This edition belongs to another book");
    editionChanged = true;
    values.editionId = editionId;
    if (patch.instanceId === undefined) values.instanceId = null;
    totals = { ...totals, totalPages: patch.totalPages !== undefined ? patch.totalPages : (edition?.pageCount ?? null) };
    // The place moves by its share of the work
    const current = remapPosition(reading.currentPercent, totals);
    const start = remapPosition(reading.startPercent, totals);
    Object.assign(values, {
      totalPages: totals.totalPages,
      currentPage: current.page,
      currentMinutes: reading.currentMinutes,
      startPage: reading.startPage != null || reading.startPercent != null ? start.page : null,
      unit: totals.totalPages == null && reading.unit === "pages" ? "percent" : reading.unit,
    });
  } else if (patch.totalPages !== undefined || patch.totalMinutes !== undefined) {
    totals = {
      totalPages: patch.totalPages !== undefined ? patch.totalPages : totals.totalPages,
      totalMinutes: patch.totalMinutes !== undefined ? patch.totalMinutes : totals.totalMinutes,
    };
    if (totals.totalPages != null && ((reading.currentPage ?? 0) > totals.totalPages || (reading.startPage ?? 0) > totals.totalPages))
      throw new Error(`You are on p. ${Math.max(reading.currentPage ?? 0, reading.startPage ?? 0)}; the book cannot have ${totals.totalPages} pages`);
    if (totals.totalMinutes != null && ((reading.currentMinutes ?? 0) > totals.totalMinutes || (reading.startMinutes ?? 0) > totals.totalMinutes))
      throw new Error(`You are at ${Math.floor(Math.max(reading.currentMinutes ?? 0, reading.startMinutes ?? 0) / 60)}:${String(Math.max(reading.currentMinutes ?? 0, reading.startMinutes ?? 0) % 60).padStart(2, "0")}; the book cannot be ${Math.floor(totals.totalMinutes / 60)}:${String(totals.totalMinutes % 60).padStart(2, "0")} long`);
    Object.assign(values, {
      ...totals,
      currentPercent: percentOf({ page: reading.currentPage, minutes: reading.currentMinutes, percent: reading.currentPercent }, totals),
      startPercent:
        reading.startPage != null || reading.startMinutes != null || reading.startPercent != null
          ? percentOf({ page: reading.startPage, minutes: reading.startMinutes, percent: reading.startPercent }, totals)
          : null,
    });
  }
  if (patch.locationId !== undefined) {
    if (patch.locationId) {
      const [place] = await db.select({ type: locations.type }).from(locations).where(eq(locations.id, patch.locationId));
      if (!place) throw new Error("This place no longer exists");
      if (place.type !== "physical") throw new Error("A reading's home is a physical place");
    }
    values.locationId = patch.locationId;
  }
  if (patch.format !== undefined) values.format = patch.format;
  if (patch.unit !== undefined) values.unit = patch.unit;
  // Dates: the finish only on a finished or abandoned read, after the start
  const started =
    patch.startedPrecision !== undefined || patch.startedOn !== undefined
      ? {
          precision: patch.startedPrecision ?? reading.startedPrecision,
          on: patch.startedOn !== undefined ? patch.startedOn : reading.startedOn,
        }
      : null;
  if (started) {
    values.startedOn = started.precision === "unknown" || !started.on ? null : readingPeriodStart(started.on, started.precision);
    values.startedPrecision = values.startedOn ? started.precision : "unknown";
  }
  if (patch.finishedPrecision !== undefined || patch.finishedOn !== undefined) {
    if (isOpenStatus(reading.status)) throw new Error("An open reading has no finish date");
    const precision = patch.finishedPrecision ?? reading.finishedPrecision;
    const on = patch.finishedOn !== undefined ? patch.finishedOn : reading.finishedOn;
    values.finishedOn = precision === "unknown" || !on ? null : readingPeriodStart(on, precision);
    values.finishedPrecision = values.finishedOn ? precision : "unknown";
  }
  const { finishAfterStart } = await import("@/lib/validations/reading");
  if (
    !finishAfterStart({
      startedOn: values.startedOn !== undefined ? values.startedOn : reading.startedOn,
      startedPrecision: values.startedPrecision ?? reading.startedPrecision,
      finishedOn: values.finishedOn !== undefined ? values.finishedOn : reading.finishedOn,
      finishedPrecision: values.finishedPrecision ?? reading.finishedPrecision,
    })
  )
    throw new Error("The finish date is before the start date");
  if (patch.rating !== undefined) values.rating = patch.rating;
  if (patch.reviewHtml !== undefined) values.reviewHtml = patch.reviewHtml ? sanitizeCommentHtml(patch.reviewHtml) : null;
  if (patch.reviewJson !== undefined) values.reviewJson = patch.reviewJson ?? null;
  if (patch.abandonReason !== undefined || patch.abandonNote !== undefined) {
    if (reading.status !== "abandoned") throw new Error("Only an abandoned read has a reason");
    if (patch.abandonReason !== undefined) values.abandonReason = patch.abandonReason;
    if (patch.abandonNote !== undefined) values.abandonNote = patch.abandonNote;
  }
  const now = new Date();
  await withReadableErrors(() =>
    atomic((d) => [
      ...guardReading(d, reading.id, fingerprint),
      d.update(readings).set({ ...values, updatedAt: now }).where(eq(readings.id, reading.id)),
    ]),
  );
  const fresh = (await loadReading(reading.id))!;
  if (editionChanged) event(reading.workId, "work.reading_edition_changed", fresh, { editionTitle: await editionTitle(fresh.editionId) });
  changed();
  return fresh;
}

/** Deletes a reading with its sessions and history; the snapshot lets the page undo it */
export async function deleteReading(input: z.input<typeof statusChangeSchema>) {
  const { readingId, fingerprint } = statusChangeSchema.parse(input);
  await refuseWhileTiming(readingId);
  const reading = await readingFor(readingId, fingerprint);
  const [sessions, history, notes] = await Promise.all([
    loadSessions(reading.id),
    db.select().from(readingStatusHistory).where(eq(readingStatusHistory.readingId, reading.id)),
    // Its quotes and notes stay with the book; Undo links them back (SLN-453)
    db.select({ id: readingNotes.id }).from(readingNotes).where(eq(readingNotes.readingId, reading.id)),
  ]);
  await withReadableErrors(() =>
    atomic((d) => [...guardReading(d, reading.id, fingerprint), d.delete(readings).where(eq(readings.id, reading.id))]),
  );
  event(reading.workId, "work.reading_deleted", reading);
  changed();
  const { fingerprint: _f, ...row } = reading;
  return { reading: row, sessions, history, noteIds: notes.map((n) => n.id) };
}

const snapshotSchema = z.object({
  reading: z.record(z.string(), z.unknown()),
  sessions: z.array(z.record(z.string(), z.unknown())),
  history: z.array(z.record(z.string(), z.unknown())),
  noteIds: z.array(z.uuid()).max(100_000).optional(),
});

const asDate = (v: unknown) => (v == null ? null : new Date(v as string));

/** Puts a deleted reading back with the same ids; an edition, copy or place gone meanwhile comes back empty */
export async function restoreReading(input: z.input<typeof snapshotSchema>) {
  const snap = snapshotSchema.parse(input);
  const r = snap.reading as unknown as Reading;
  await requireBookWork(r.workId);
  if (isOpenStatus(r.status)) {
    const open = await openReadingOf(r.workId);
    if (open) throw new Error(openReadingMessage(open.status));
  }
  const exists = async (table: typeof editions | typeof instances | typeof locations, id: string | null) =>
    id ? (await db.select({ id: table.id }).from(table).where(eq(table.id, id))).length > 0 : false;
  const editionOk = await exists(editions, r.editionId);
  const instanceOk = editionOk && (await exists(instances, r.instanceId));
  const locationOk = await exists(locations, r.locationId);
  const sessionEditions = new Set<string>();
  for (const s of snap.sessions as unknown as Session[])
    if (s.editionId && (await exists(editions, s.editionId))) sessionEditions.add(s.editionId);
  await withReadableErrors(() =>
    atomic((d) => [
      d.insert(readings).values({
        ...r,
        editionId: editionOk ? r.editionId : null,
        instanceId: instanceOk ? r.instanceId : null,
        locationId: locationOk ? r.locationId : null,
        lastReadAt: asDate(r.lastReadAt),
        createdAt: asDate(r.createdAt) ?? new Date(),
        updatedAt: new Date(),
      }),
      ...(snap.sessions.length
        ? [
            d.insert(readingSessions).values(
              (snap.sessions as unknown as Session[]).map(({ pagesRead: _p, ...s }) => ({
                ...s,
                editionId: s.editionId && sessionEditions.has(s.editionId) ? s.editionId : null,
                startedAt: asDate(s.startedAt),
                endedAt: asDate(s.endedAt),
                createdAt: asDate(s.createdAt) ?? new Date(),
                updatedAt: asDate(s.updatedAt) ?? new Date(),
              })),
            ),
          ]
        : []),
      ...(snap.history.length
        ? [
            d.insert(readingStatusHistory).values(
              (snap.history as unknown as (typeof readingStatusHistory.$inferSelect)[]).map((h) => ({
                ...h,
                changedAt: asDate(h.changedAt) ?? new Date(),
              })),
            ),
          ]
        : []),
      // Its notes come back to it where nothing else claimed them and they are still on the book
      ...(snap.noteIds?.length
        ? [
            d
              .update(readingNotes)
              .set({ readingId: r.id })
              .where(and(inArray(readingNotes.id, snap.noteIds), isNull(readingNotes.readingId), eq(readingNotes.workId, r.workId))),
          ]
        : []),
    ]),
  );
  changed();
  return (await loadReading(r.id))!;
}

/** Edits one session; the next session's start and the position follow */
export async function updateSession(input: SessionPatchInput) {
  const { sessionId, fingerprint, end, ...patch } = sessionPatchSchema.parse(input);
  const [session] = await db.select().from(readingSessions).where(eq(readingSessions.id, sessionId));
  if (!session) throw new Error("This session no longer exists");
  if (session.source === "timer" && !session.endedAt) throw new Error("Stop the timer before editing its session");
  const reading = await readingFor(session.readingId, fingerprint);
  await requireBookWork(reading.workId);
  const sessions = await loadSessions(reading.id);
  let pagesTotal = session.pagesTotal;
  const editionId = patch.editionId !== undefined ? patch.editionId : session.editionId;
  if (patch.editionId !== undefined && editionId !== session.editionId) {
    const edition = await editionPages(editionId);
    if (editionId && (!edition || edition.workId !== reading.workId)) throw new Error("This edition belongs to another book");
    pagesTotal = editionId && editionId !== reading.editionId ? (edition?.pageCount ?? reading.totalPages) : reading.totalPages;
  }
  const totals = { totalPages: pagesTotal, totalMinutes: reading.totalMinutes };
  let endValues = {};
  if (end) {
    checkWithinTotals(end, totals);
    const p = completePosition(end, totals);
    endValues = { endPage: p.page, endPercent: p.percent, endMinutes: p.minutes, ...(end.chapter !== undefined ? { endChapter: end.chapter } : {}) };
  }
  const updated: Session = {
    ...session,
    ...patch,
    editionId,
    pagesTotal,
    ...endValues,
    readOn: patch.readOn ?? session.readOn,
    timeZone: patch.timeZone ?? session.timeZone,
    startedAt: patch.startedAt !== undefined ? patch.startedAt : session.startedAt,
    endedAt: patch.endedAt !== undefined ? patch.endedAt : session.endedAt,
  } as Session;
  if (updated.startedAt && updated.endedAt && updated.endedAt < updated.startedAt) throw new Error("The session ends before it starts");
  refuseOverlap(sessions, updated, updated.timeZone, updated.id);
  // A session moved after today would hold the position until that day, as in logProgress
  const ahead = (at: Date | null | undefined) => !!at && at.getTime() - Date.now() > 60_000;
  if (updated.readOn > readingDay(new Date(), updated.timeZone, 0) || ahead(patch.startedAt) || ahead(patch.endedAt)) throw new Error(FUTURE_SESSION);
  const now = new Date();
  await withReadableErrors(() =>
    atomic((d) => [
      ...guardReading(d, reading.id, fingerprint),
      d
        .update(readingSessions)
        .set({
          readOn: updated.readOn,
          timeZone: updated.timeZone,
          startedAt: updated.startedAt,
          endedAt: updated.endedAt,
          durationSeconds: updated.durationSeconds,
          editionId: updated.editionId,
          format: updated.format,
          note: updated.note,
          pagesTotal: updated.pagesTotal,
          endPage: updated.endPage,
          endPercent: updated.endPercent,
          endMinutes: updated.endMinutes,
          endChapter: updated.endChapter,
          updatedAt: now,
        })
        .where(eq(readingSessions.id, session.id)),
      ...recomputeQueries(d, reading, sessions.map((s) => (s.id === session.id ? updated : s)), now),
    ]),
  );
  changed();
  return (await loadReading(reading.id))!;
}

/** Two sessions of a reading never share time: a session that crosses another's is refused, with that one's times */
function refuseOverlap(sessions: Session[], session: Omit<TimedSession, "id">, zone: string, exceptId?: string) {
  const other = overlappingSession(sessions, sessionSpan(session), exceptId);
  if (other) throw new Error(`${overlapMessage(other, zone)}. Change the start time or the time read.`);
}

/**
 * Adds a session by hand (SLN-451): always one new session, in its place in
 * the session order. The next session's start follows; the position moves
 * only when it is the newest, so a backdated session never moves it back.
 */
export async function addSession(input: AddSessionInput) {
  const data = addSessionSchema.parse(input);
  const before = await readingFor(data.readingId, data.fingerprint);
  await requireBookWork(before.workId);
  const hour = await readingDayStartHour();
  for (const at of [data.startedAt, data.endedAt])
    if (at && readingDay(at, data.timeZone, hour) !== data.readOn) throw new Error("The start and end times must fall on the session's day");
  const durationSeconds =
    data.durationSeconds ?? (data.startedAt && data.endedAt ? Math.max(1, Math.round((data.endedAt.getTime() - data.startedAt.getTime()) / 1000)) : null);
  refuseOverlap(await loadSessions(before.id), { startedAt: data.startedAt ?? null, endedAt: data.endedAt ?? null, durationSeconds }, data.timeZone);
  const result = await recordProgress(
    {
      readingId: data.readingId,
      ...data.to,
      chapter: data.chapter ?? undefined,
      readOn: data.readOn,
      startedAt: data.startedAt ?? undefined,
      endedAt: data.endedAt ?? undefined,
      durationSeconds: durationSeconds ?? undefined,
      note: data.note,
      goingBack: "went_back",
      timeZone: data.timeZone,
    },
    { fingerprint: data.fingerprint, source: "manual", editionId: data.editionId, format: data.format },
  );
  if (result.resumed) event(before.workId, "work.reading_resumed", result.reading);
  await progressEvent(result.reading, result.session.readOn);
  changed();
  return result;
}

/** Puts a deleted session back with its id and source (the Undo of a delete); refused for a running timer */
export async function restoreSession(input: z.input<typeof restoreSessionSchema>) {
  const data = restoreSessionSchema.parse(input);
  const snap = data.snapshot as unknown as Session;
  if (snap.readingId !== data.readingId) throw new Error("This session belongs to another reading");
  if (snap.source === "timer" && !snap.endedAt) throw new Error("A running timer cannot be put back");
  const reading = await readingFor(data.readingId, data.fingerprint);
  await requireBookWork(reading.workId);
  const sessions = await loadSessions(reading.id);
  if (sessions.some((s) => s.id === snap.id)) throw new Error("This session is already there");
  const editionOk = snap.editionId ? (await editionPages(snap.editionId))?.workId === reading.workId : true;
  const { pagesRead: _p, ...values } = snap;
  const row: Session = {
    ...snap,
    editionId: editionOk ? snap.editionId : null,
    startedAt: asDate(snap.startedAt),
    endedAt: asDate(snap.endedAt),
    pausedAt: null,
    pausedSeconds: snap.pausedSeconds ?? 0,
    createdAt: asDate(snap.createdAt) ?? new Date(),
    updatedAt: new Date(),
  };
  const now = new Date();
  await withReadableErrors(() =>
    atomic((d) => [
      ...guardReading(d, reading.id, data.fingerprint),
      d.insert(readingSessions).values({ ...values, ...row, pagesRead: undefined } as typeof readingSessions.$inferInsert),
      ...recomputeQueries(d, reading, [...sessions, row], now),
    ]),
  );
  changed();
  return (await loadReading(reading.id))!;
}

/** Removes one session; with none left, the position returns to the start. Returns the row, for Undo */
export async function deleteSession(input: z.input<typeof deleteSessionSchema>) {
  const { sessionId, fingerprint } = deleteSessionSchema.parse(input);
  const [session] = await db.select().from(readingSessions).where(eq(readingSessions.id, sessionId));
  if (!session) throw new Error("This session no longer exists");
  if (session.source === "timer" && !session.endedAt) throw new Error("Stop the timer before deleting its session");
  const reading = await readingFor(session.readingId, fingerprint);
  const sessions = await loadSessions(reading.id);
  const now = new Date();
  await withReadableErrors(() =>
    atomic((d) => [
      ...guardReading(d, reading.id, fingerprint),
      d.delete(readingSessions).where(eq(readingSessions.id, session.id)),
      ...recomputeQueries(d, reading, sessions.filter((s) => s.id !== session.id), now),
    ]),
  );
  changed();
  return { reading: (await loadReading(reading.id))!, session };
}

export type SessionRow = Session & { editionTitle: string | null };

/** One reading's sessions for its list (SLN-451): newest first in the session order, the running timer apart */
export async function getReadingSessions(readingId: string): Promise<{ running: SessionRow | null; sessions: SessionRow[] }> {
  const id = z.uuid().parse(readingId);
  const rows = await db
    .select({ session: readingSessions, editionTitle: editions.title })
    .from(readingSessions)
    .leftJoin(editions, eq(editions.id, readingSessions.editionId))
    .where(eq(readingSessions.readingId, id));
  const withTitle = (s: Session): SessionRow => ({ ...s, editionTitle: rows.find((r) => r.session.id === s.id)?.editionTitle ?? null });
  const all = rows.map((r) => r.session);
  const running = all.find(isRunningTimer);
  return { running: running ? withTitle(running) : null, sessions: sessionOrder(all).reverse().map(withTitle) };
}

/**
 * A book's readings, newest first: each with its fingerprint, its number
 * among the book's readings, its sessions and time, its edition, copy and home.
 */
export async function getReadingsForWork(workId: string) {
  const id = z.uuid().parse(workId);
  return resultRows<{
    reading: Reading;
    fingerprint: string;
    ordinal: number;
    sessionCount: number;
    totalSeconds: number;
    /** Its quotes and notes (SLN-453), which a delete leaves with the book */
    quoteCount: number;
    noteCount: number;
    edition: { id: string; title: string; coverS3Key: string | null; thumbnailS3Key: string | null; pageCount: number | null; language: string | null; translators: string[] } | null;
    copy: { id: string; location: string | null; shelf: string | null } | null;
    home: { id: string; name: string } | null;
  }>(
    await db.execute(sql`select to_jsonb(r) as reading, md5(to_jsonb(r)::text) as fingerprint,
        ${readingOrdinalSql("r")} as ordinal,
        (select count(*)::int from reading_sessions s where s.reading_id = r.id and not (s.source = 'timer' and s.ended_at is null)) as "sessionCount",
        (select coalesce(sum(s.duration_seconds), 0)::int from reading_sessions s where s.reading_id = r.id) as "totalSeconds",
        (select count(*)::int from reading_notes n where n.reading_id = r.id and n.kind = 'quote') as "quoteCount",
        (select count(*)::int from reading_notes n where n.reading_id = r.id and n.kind = 'note') as "noteCount",
        (select jsonb_build_object('id', e.id, 'title', e.title, 'coverS3Key', e.cover_s3_key, 'thumbnailS3Key', e.thumbnail_s3_key,
            'pageCount', e.page_count, 'language', e.language,
            'translators', coalesce((select jsonb_agg(a.name order by ec.sort_order) from edition_contributors ec join authors a on a.id = ec.author_id
              where ec.edition_id = e.id and ec.role = 'translator'), '[]'::jsonb))
          from editions e where e.id = r.edition_id) as edition,
        (select jsonb_build_object('id', i.id, 'location', l.name, 'shelf', sl.name)
          from instances i left join locations l on l.id = i.location_id left join sub_locations sl on sl.id = i.sub_location_id
          where i.id = r.instance_id) as copy,
        (select jsonb_build_object('id', l.id, 'name', l.name) from locations l where l.id = r.location_id) as home
      from readings r where r.work_id = ${id}::uuid
      order by (r.status in ('reading','paused')) desc, coalesce(r.finished_on, r.started_on) desc nulls last, r.created_at desc`),
  ).map((row) => ({ ...row, reading: camelReading(row.reading as unknown as Record<string, unknown>) }));
}

/** A readings row from to_jsonb, in the field names the app uses */
function camelReading(row: Record<string, unknown>): Reading {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  for (const key of ["lastReadAt", "createdAt", "updatedAt"]) if (out[key]) out[key] = new Date(out[key] as string);
  return out as Reading;
}

/** Every open reading: for the hub, the dashboard and the command palette */
export async function getOpenReadings() {
  return resultRows<{
    reading: Reading;
    fingerprint: string;
    work: { id: string; title: string; slug: string | null };
    author: string | null;
    cover: string | null;
    pausedAt: string | null;
  }>(
    await db.execute(sql`select to_jsonb(r) as reading, md5(to_jsonb(r)::text) as fingerprint,
        jsonb_build_object('id', w.id, 'title', w.title, 'slug', w.slug) as work,
        (select max(h.changed_at) from reading_status_history h where h.reading_id = r.id and h.to_status = 'paused') as "pausedAt",
        (select a.name from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id order by wa.sort_order limit 1) as author,
        coalesce((select e.thumbnail_s3_key from editions e where e.id = r.edition_id),
          (select m.thumbnail_s3_key from media m where m.work_id = w.id and m.type = 'poster' and m.is_active order by m.sort_order limit 1)) as cover
      from readings r join works w on w.id = r.work_id
      where r.status in ('reading','paused')
      order by r.last_read_at desc nulls last, r.started_on desc nulls last, r.created_at desc`),
  ).map((row) => ({ ...row, reading: camelReading(row.reading as unknown as Record<string, unknown>) }));
}

/** The reading history, quotes and notes a book delete removes */
export async function getReadingCounts(workId: string) {
  const id = z.uuid().parse(workId);
  const [row] = resultRows<{ readings: number; sessions: number; quotes: number; notes: number }>(
    await db.execute(sql`select (select count(*)::int from readings where work_id = ${id}::uuid) as readings,
      (select count(*)::int from reading_sessions s join readings r on r.id = s.reading_id where r.work_id = ${id}::uuid) as sessions,
      n.quotes, n.notes
      from (select count(*) filter (where kind = 'quote')::int as quotes, count(*) filter (where kind = 'note')::int as notes
        from reading_notes where work_id = ${id}::uuid) n`),
  );
  return row ?? { readings: 0, sessions: 0, quotes: 0, notes: 0 };
}

/**
 * The series' next volume to read after this book, with where its copy is:
 * the copy at hand at the "I'm at" home, else its first copy in the
 * collection, else "Not owned" (the Finish dialog's panel).
 */
export async function getNextInSeries(workId: string, homeId: string | null) {
  const id = z.uuid().parse(workId);
  const home = homeId === null ? null : z.uuid().parse(homeId);
  const [work] = await db
    .select({ seriesId: works.seriesId })
    .from(works)
    .where(eq(works.id, id));
  if (!work?.seriesId) return null;
  const { nextToRead } = await import("@/lib/reading/series");
  const next = await nextToRead(work.seriesId);
  if (!next || next.id === id) return null;
  const { atHandCopySql, copyWhereabouts } = await import("@/lib/reading/at-hand");
  const [copy] = resultRows<{
    status: string;
    locationId: string;
    locationType: string | null;
    locationName: string | null;
    subLocationName: string | null;
    lentTo: string | null;
    lentDate: string | null;
  }>(
    await db.execute(sql`select i.status, i.location_id as "locationId", l.type as "locationType", l.name as "locationName",
        sl.name as "subLocationName", i.lent_to as "lentTo", i.lent_date::text as "lentDate"
      from instances i join locations l on l.id = i.location_id left join sub_locations sl on sl.id = i.sub_location_id
      where i.id = coalesce((${atHandCopySql(next.id, home)} limit 1),
        (select i2.id from instances i2 join editions e2 on e2.id = i2.edition_id
          where e2.work_id = ${next.id}::uuid and i2.status <> 'deaccessioned'
          order by (i2.status = 'available') desc, i2.created_at, i2.id limit 1))`),
  );
  const [named] = resultRows<{ title: string }>(
    await db.execute(sql`select title from series where id = ${work.seriesId}::uuid`),
  );
  return {
    id: next.id,
    title: next.title,
    slug: next.slug ?? null,
    seriesTitle: named?.title ?? null,
    whereabouts: copy ? copyWhereabouts(copy, { today: await readingToday() }) : "Not owned",
  };
}

/**
 * An edition's page count from the configured sources (ISBNdb by ISBN, then
 * Open Library by its edition key), for the Start dialog. Writes nothing:
 * saving it to the edition is the match flow's job.
 */
export async function findPageCount(editionId: string) {
  const id = z.uuid().parse(editionId);
  const [edition] = await db
    .select({ isbn13: editions.isbn13, openLibraryKey: editions.openLibraryKey })
    .from(editions)
    .where(eq(editions.id, id));
  if (!edition) throw new Error("This edition no longer exists");
  const { fetchSourceRecord } = await import("@/lib/match/source");
  const tries: [string, string | null][] = [
    ["isbndb", edition.isbn13],
    ["open_library", edition.openLibraryKey?.includes("/books/") ? edition.openLibraryKey : null],
  ];
  for (const [source, key] of tries) {
    if (!key) continue;
    try {
      const record = await fetchSourceRecord(source, key);
      if (record.pageCount && record.pageCount > 0) return { pageCount: record.pageCount, source };
    } catch {
      // The next source
    }
  }
  return null;
}

export interface BookToRead {
  id: string;
  title: string;
  slug: string | null;
  author: string | null;
  cover: string | null;
  owned: boolean;
  catalogueStatus: string;
  state: "unread" | "reading" | "paused" | "read" | "abandoned";
  reads: number;
  percent: number | null;
  openReadingId: string | null;
  openFingerprint: string | null;
}

/**
 * The book picker (SLN-448): books only, matched without accents on title and
 * authors, owned books first, then by title; at most 20, with each book's
 * reading state.
 */
export async function searchBooksToRead(query: string) {
  const q = z.string().max(200).parse(query).trim();
  const { textSearchCondition } = await import("@/lib/actions/utils/text-search");
  const { ownedBookCondition } = await import("@/lib/catalogue/holdings");
  const { readingStateSql, readCountSql, openReadingPercentSql } = await import("@/lib/reading/summary");
  const authors = sql`coalesce((select string_agg(a.name, ' ') from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id), '')`;
  const match = q ? textSearchCondition(sql`search_normalize(w.title || ' ' || ${authors})`, q, { fuzzy: false }) : undefined;
  return resultRows<BookToRead>(
    await db.execute(sql`select w.id, w.title, w.slug,
        (select a.name from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id order by wa.sort_order limit 1) as author,
        (select coalesce(e.thumbnail_s3_key, e.cover_s3_key) from editions e where e.work_id = w.id and (e.thumbnail_s3_key is not null or e.cover_s3_key is not null)
          order by e.publication_year nulls last, e.id limit 1) as cover,
        ${ownedBookCondition(sql`w.id`)} as owned, w.catalogue_status as "catalogueStatus",
        ${readingStateSql(sql`w.id`)} as state, ${readCountSql(sql`w.id`)} as reads, ${openReadingPercentSql(sql`w.id`)} as percent,
        (select r.id from readings r where r.work_id = w.id and r.status in ('reading','paused') limit 1) as "openReadingId",
        (select md5(to_jsonb(r)::text) from readings r where r.work_id = w.id and r.status in ('reading','paused') limit 1) as "openFingerprint"
      from works w where w.kind = 'book' ${match ? sql`and ${match}` : sql``}
      order by ${ownedBookCondition(sql`w.id`)} desc, search_normalize(w.title), w.id limit 20`),
  );
}

/**
 * What a reading dialog needs for one book, opened away from its page (the
 * hub, the dashboard, the palette): its readings, editions with their
 * copies, the homes, its rating.
 */
export async function getReadingDialogData(workId: string, homeId: string | null = null) {
  const id = z.uuid().parse(workId);
  const home = homeId === null ? null : z.uuid().parse(homeId);
  await requireBookWork(id);
  const [{ getWork }, { getLocations }, { readingEditions, readingHomes }, rows] = await Promise.all([
    import("@/lib/actions/works"),
    import("@/lib/actions/locations"),
    import("@/lib/reading/page-data"),
    getReadingsForWork(id),
  ]);
  const [work, locations] = await Promise.all([getWork(id), getLocations()]);
  if (!work) throw new Error("Book not found");
  const zone = appTimeZone();
  const dayStartHour = await readingDayStartHour();
  const today = readingDay(new Date(), zone, dayStartHour);
  return {
    workId: work.id,
    workTitle: work.title,
    bookRating: work.rating ?? null,
    dayStartHour,
    rows,
    editions: readingEditions(work.editions, { today, homeId: home }),
    homes: readingHomes(locations),
    today,
    zone,
  };
}

export interface ReadingSummaryRow {
  state: "unread" | "reading" | "paused" | "read" | "abandoned";
  timesRead: number;
  lastFinishedOn: string | null;
  lastFinishedPrecision: string | null;
  lastReadAt: string | null;
  percent: number | null;
}

/**
 * The library list's and table's reading columns for one page of books
 * (SLN-449), in one query: loaded only while the list or table view shows,
 * so the grid's payload does not grow. At most one page of the largest size
 * (`PAGE_SIZES`, 192) of work ids.
 */
export async function getReadingSummaries(workIds: string[]): Promise<Record<string, ReadingSummaryRow>> {
  const ids = z.array(z.uuid()).max(Math.max(...PAGE_SIZES)).parse(workIds);
  if (!ids.length) return {};
  const { readingStateSql, readCountSql, lastFinishedOnSql, lastFinishedPrecisionSql, lastReadAtSql, openReadingPercentSql } = await import(
    "@/lib/reading/summary"
  );
  const rows = resultRows<ReadingSummaryRow & { id: string }>(
    await db.execute(sql`select w.id, ${readingStateSql(sql`w.id`)} as state, ${readCountSql(sql`w.id`)} as "timesRead",
        ${lastFinishedOnSql(sql`w.id`)} as "lastFinishedOn", ${lastFinishedPrecisionSql(sql`w.id`)} as "lastFinishedPrecision",
        ${lastReadAtSql(sql`w.id`)}::text as "lastReadAt", ${openReadingPercentSql(sql`w.id`)} as percent
      from works w where w.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`),
  );
  return Object.fromEntries(
    rows.map(({ id, ...row }) => [id, { ...row, timesRead: Number(row.timesRead), percent: row.percent === null ? null : Number(row.percent) }]),
  );
}

/** The years with a finished reading, for the library's "Read in" filter */
export async function getReadYearRange(): Promise<{ min: number | null; max: number | null }> {
  const [row] = resultRows<{ min: number | null; max: number | null }>(
    await db.execute(sql`select min(extract(year from finished_on))::int as min, max(extract(year from finished_on))::int as max
      from readings where status = 'finished' and finished_precision <> 'unknown' and finished_on is not null`),
  );
  return row ?? { min: null, max: null };
}

/**
 * The series page's "Next to read" (SLN-449): `nextToRead`'s volume with
 * where its copy is, for the first of an available physical copy, an
 * available digital copy, then any other copy still held; else "Not owned ·
 * Wanted" with the catalogue status.
 */
export async function getSeriesNextToRead(seriesId: string) {
  const id = z.uuid().parse(seriesId);
  const { nextToRead } = await import("@/lib/reading/series");
  const next = await nextToRead(id);
  if (!next) return null;
  const { copyWhereabouts } = await import("@/lib/reading/at-hand");
  const { catalogueStatusLabel } = await import("@/lib/utils/labels");
  const [copy] = resultRows<{
    status: string;
    locationId: string;
    locationType: string | null;
    locationName: string | null;
    subLocationName: string | null;
    lentTo: string | null;
    lentDate: string | null;
  }>(
    await db.execute(sql`select i.status, i.location_id as "locationId", l.type as "locationType", l.name as "locationName",
        sl.name as "subLocationName", i.lent_to as "lentTo", i.lent_date::text as "lentDate"
      from instances i join editions e on e.id = i.edition_id join locations l on l.id = i.location_id
      left join sub_locations sl on sl.id = i.sub_location_id
      where e.work_id = ${next.id}::uuid and i.status <> 'deaccessioned'
      order by (i.status = 'available' and l.type = 'physical') desc, (i.status = 'available') desc, i.created_at, i.id
      limit 1`),
  );
  const [work] = await db.select({ catalogueStatus: works.catalogueStatus }).from(works).where(eq(works.id, next.id));
  return {
    id: next.id,
    title: next.title,
    slug: next.slug ?? null,
    position: next.position ?? null,
    whereabouts: copy
      ? copyWhereabouts(copy, { today: await readingToday() })
      : ["Not owned", work ? catalogueStatusLabel(work.catalogueStatus) : null].filter(Boolean).join(" · "),
  };
}
