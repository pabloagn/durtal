import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
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
} from "@/lib/db/schema";
import { appTimeZone } from "@/lib/utils/date";
import { sanitizeCommentHtml } from "@/lib/utils/sanitize";
import {
  formatOfCopy,
  isOpenStatus,
  type ReadingFormat,
  type ReadingSource,
  type ReadingStatus,
  type SessionSource,
} from "./constants";
import { readingDay, readingPeriodStart } from "./dates";
import { readingDayStartHour } from "./day";
import { stopProblem, stopTimes, TIMER_GONE } from "./timer";
import { getAppSettings } from "@/lib/actions/settings";
import { formatMinutes, percentOf, remapPosition } from "./positions";
import { duplicateVerdicts, type ExistingReading } from "./duplicates";
import {
  createReadingSchema,
  progressSchema,
  writeReadingRowSchema,
  type CreateReadingInput,
  type ProgressInput,
  type WriteReadingRow,
} from "@/lib/validations/reading";

/*
 * Every reading write goes through this module (SLN-444): the page actions,
 * the REST routes, the reader, the importers, the seed and the backfill.
 * Writes read and check first, then run one atomic batch that locks the
 * reading and asserts its fingerprint, so values computed here are only
 * applied to the row they were computed from. Every write that touches a
 * reading or its sessions sets `updated_at`, which changes the fingerprint.
 */

export type Reading = typeof readings.$inferSelect;
export type Session = typeof readingSessions.$inferSelect;
export type ReadingWithFingerprint = Reading & { fingerprint: string };
type Db = typeof db;

export const STALE_READING = "This reading changed elsewhere; reload before saving";
const STALE_RETRY = "This reading changed elsewhere; try again";
/** A session dated after today would hold the position until that day comes */
export const FUTURE_SESSION = "This session is in the future";

/** The md5 of the readings row, as the curation snapshot is fingerprinted */
export function readingFingerprintSql(readingId: SQL | string) {
  return sql<string>`(select md5(to_jsonb(r)::text) from readings r where r.id = ${readingId}::uuid)`;
}

export async function loadReading(id: string): Promise<ReadingWithFingerprint | null> {
  const [row] = await db
    .select({ reading: readings, fingerprint: sql<string>`md5(to_jsonb(${readings})::text)` })
    .from(readings)
    .where(eq(readings.id, id));
  return row ? { ...row.reading, fingerprint: row.fingerprint } : null;
}

/** The running timer: a timer session not yet stopped */
export const isRunningTimer = (s: Pick<Session, "source" | "endedAt">) => s.source === "timer" && !s.endedAt;

const orderKey = (s: Session) =>
  [s.readOn, (s.endedAt ?? s.startedAt ?? s.createdAt).toISOString(), s.createdAt.toISOString(), s.id] as const;

/** Sessions in reading order, the running timer left out */
export function sessionOrder(sessions: Session[]) {
  return sessions
    .filter((s) => !isRunningTimer(s))
    .sort((a, b) => {
      const ka = orderKey(a),
        kb = orderKey(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
      return 0;
    });
}

async function loadSessions(readingId: string) {
  return db.select().from(readingSessions).where(eq(readingSessions.readingId, readingId));
}

export interface Pos {
  page: number | null;
  percent: number | null;
  minutes: number | null;
  chapter: string | null;
}

/** Where tracking began: the reading's start, else 0 */
export function startPosition(r: Pick<Reading, "startPage" | "startPercent" | "startMinutes" | "totalPages" | "totalMinutes">): Pos {
  const none = r.startPage == null && r.startPercent == null && r.startMinutes == null;
  if (none) return { page: 0, percent: 0, minutes: 0, chapter: null };
  return { page: r.startPage, percent: r.startPercent, minutes: r.startMinutes, chapter: null };
}

const currentOf = (r: Reading): Pos => ({
  page: r.currentPage,
  percent: r.currentPercent,
  minutes: r.currentMinutes,
  chapter: r.currentChapter,
});

/**
 * Each session's start and the reading's position, from the sessions in
 * order: a session starts where the one before it ended (the reading's start
 * for the first); an open reading is where its latest session ended, read
 * through the share of the work when that session used another edition. A
 * reader sitting that ends behind the furthest point leaves the position.
 */
export function planPositions(reading: Reading, ordered: Session[]) {
  const starts = new Map<string, { startPage: number | null; startPercent: number | null; startMinutes: number | null }>();
  let prev = startPosition(reading);
  let prevEdition = reading.editionId;
  let position: Pos = { ...startPosition(reading), chapter: null };
  if (reading.startPage == null && reading.startPercent == null && reading.startMinutes == null)
    position = { page: reading.totalPages ? 0 : null, percent: 0, minutes: reading.totalMinutes ? 0 : null, chapter: null };
  for (const s of ordered) {
    const sameEdition = s.editionId === prevEdition;
    starts.set(s.id, {
      startPercent: prev.percent,
      startPage: sameEdition ? prev.page : s.pagesTotal && prev.percent != null ? Math.round((prev.percent / 100) * s.pagesTotal) : null,
      startMinutes: prev.minutes,
    });
    prev = { page: s.endPage, percent: s.endPercent, minutes: s.endMinutes, chapter: s.endChapter };
    prevEdition = s.editionId;
    if (s.source === "reader" && s.endPercent != null && position.percent != null && s.endPercent < position.percent) continue;
    if (s.editionId === reading.editionId) {
      const mapped = remapPosition(s.endPercent, reading);
      position = {
        page: s.endPage ?? mapped.page,
        percent: s.endPercent,
        minutes: s.endMinutes ?? mapped.minutes,
        chapter: s.endChapter ?? position.chapter,
      };
    } else {
      const mapped = remapPosition(s.endPercent, reading);
      position = { page: mapped.page, percent: s.endPercent, minutes: mapped.minutes, chapter: s.endChapter ?? position.chapter };
    }
  }
  return { starts, position };
}

/** The statements that lock a reading and check it is the row the write was computed from */
function guardReading(d: Db, readingId: string, fingerprint: string, message = STALE_READING) {
  return [
    d.execute(sql`select id from readings where id = ${readingId}::uuid for update`),
    d.execute(
      assertSql(sql`coalesce((${readingFingerprintSql(readingId)}) = ${fingerprint}, false)`, message),
    ),
  ];
}

/** Session start updates for the sessions whose start changed */
function startUpdates(d: Db, ordered: Session[], starts: ReturnType<typeof planPositions>["starts"]) {
  return ordered.flatMap((s) => {
    const start = starts.get(s.id)!;
    if (start.startPage === s.startPage && start.startPercent === s.startPercent && start.startMinutes === s.startMinutes) return [];
    return [d.update(readingSessions).set({ ...start, updatedAt: new Date() }).where(eq(readingSessions.id, s.id))];
  });
}

function positionValues(p: Pos) {
  return { currentPage: p.page, currentPercent: p.percent, currentMinutes: p.minutes, currentChapter: p.chapter };
}

/** Pages past the last one, or minutes past the end, in the words of the field */
function checkWithinTotals(p: { page?: number | null; minutes?: number | null }, totals: { totalPages: number | null; totalMinutes: number | null }) {
  if (p.page != null && totals.totalPages != null && p.page > totals.totalPages)
    throw new Error(`Page ${p.page} is past the last page, ${totals.totalPages}`);
  if (p.minutes != null && totals.totalMinutes != null && p.minutes > totals.totalMinutes)
    throw new Error(`${formatMinutes(p.minutes)} is past the end, ${formatMinutes(totals.totalMinutes)}`);
}

/** Books only: the message every reading writer gives for anything else */
export async function requireReadableWorks(workIds: string[]) {
  const ids = [...new Set(workIds)];
  if (!ids.length) return new Set<string>();
  const rows = await db.select({ id: works.id, kind: works.kind }).from(works).where(inArray(works.id, ids));
  const books = new Set(rows.filter((r) => r.kind === "book").map((r) => r.id));
  return books;
}

async function editionPages(editionId: string | null | undefined) {
  if (!editionId) return null;
  const [row] = await db.select({ workId: editions.workId, pageCount: editions.pageCount }).from(editions).where(eq(editions.id, editionId));
  return row ?? null;
}

/** A position given one way (page, share or minutes) completed the other ways */
function completePosition(given: { page?: number | null; percent?: number | null; minutes?: number | null }, totals: { totalPages: number | null; totalMinutes: number | null }) {
  const percent = percentOf(given, totals);
  const mapped = remapPosition(percent, totals);
  return {
    page: given.page ?? mapped.page,
    percent,
    minutes: given.minutes ?? mapped.minutes,
  };
}

/** The open reading of a book, if any */
async function openReadingOf(workId: string) {
  const [row] = await db
    .select({ id: readings.id, status: readings.status })
    .from(readings)
    .where(and(eq(readings.workId, workId), inArray(readings.status, ["reading", "paused"])));
  return row ?? null;
}

export function openReadingMessage(status: string) {
  return status === "paused" ? "This book has a paused reading; resume it" : "This book is already being read";
}

/**
 * Starts a reading (or a paused one): its edition and copy, home, format,
 * unit, totals, start date and start position. With a source key that
 * already exists, returns that reading unchanged.
 */
export async function createReading(
  raw: CreateReadingInput,
  opts: { source: ReadingSource; sourceKey?: string | null; importId?: string | null },
): Promise<ReadingWithFingerprint> {
  const input = createReadingSchema.parse(raw);
  if (opts.sourceKey) {
    const [existing] = await db.select({ id: readings.id }).from(readings).where(eq(readings.sourceKey, opts.sourceKey));
    if (existing) return (await loadReading(existing.id))!;
  }
  if (!(await requireReadableWorks([input.workId])).has(input.workId)) throw new Error("Only books can be read");
  const open = await openReadingOf(input.workId);
  if (open) throw new Error(openReadingMessage(open.status));

  // The copy decides the edition, the home and the format when they are not given
  let editionId = input.editionId ?? null;
  let copy: { editionId: string; format: string | null; locationId: string | null; locationType: string | null } | null = null;
  if (input.instanceId) {
    const [row] = await db
      .select({ editionId: instances.editionId, format: instances.format, locationId: instances.locationId, locationType: locations.type })
      .from(instances)
      .leftJoin(locations, eq(locations.id, instances.locationId))
      .where(eq(instances.id, input.instanceId));
    if (!row) throw new Error("This copy no longer exists");
    copy = row;
    editionId ??= row.editionId;
  }
  const edition = await editionPages(editionId);
  if (editionId && (!edition || edition.workId !== input.workId)) throw new Error("This edition belongs to another book");
  let locationId = input.locationId ?? null;
  if (locationId) {
    const [place] = await db.select({ type: locations.type }).from(locations).where(eq(locations.id, locationId));
    if (!place) throw new Error("This place no longer exists");
    if (place.type !== "physical") throw new Error("A reading's home is a physical place");
  } else if (copy?.locationType === "physical") locationId = copy.locationId;
  const format: ReadingFormat = input.format ?? formatOfCopy(copy?.format);
  const unit = input.unit ?? (format === "audio" ? "minutes" : "pages");
  const totals = { totalPages: input.totalPages ?? edition?.pageCount ?? null, totalMinutes: input.totalMinutes ?? null };
  const timeZone = input.timeZone ?? appTimeZone();
  const precision = input.startedPrecision ?? "day";
  const startedOn =
    precision === "unknown" ? null : readingPeriodStart(input.startedOn ?? readingDay(new Date(), timeZone, await readingDayStartHour()), precision);
  const given = { page: input.startPage, percent: input.startPercent, minutes: input.startMinutes };
  const anyStart = [given.page, given.percent, given.minutes].some((v) => v != null);
  checkWithinTotals(given, totals);
  const start = anyStart ? completePosition(given, totals) : { page: null, percent: null, minutes: null };
  const id = randomUUID();
  const status = input.status ?? "reading";
  await withReadableErrors(() =>
    atomic((d) => [
      d.insert(readings).values({
        id,
        workId: input.workId,
        editionId,
        instanceId: input.instanceId ?? null,
        locationId,
        format,
        status,
        startedOn,
        startedPrecision: startedOn ? precision : "unknown",
        unit,
        ...totals,
        startPage: start.page,
        startPercent: start.percent,
        startMinutes: start.minutes,
        currentPage: anyStart ? start.page : totals.totalPages ? 0 : null,
        currentPercent: anyStart ? start.percent : 0,
        currentMinutes: anyStart ? start.minutes : totals.totalMinutes ? 0 : null,
        source: opts.source,
        sourceKey: opts.sourceKey ?? null,
        importId: opts.importId ?? null,
      }),
      d.insert(readingStatusHistory).values({ readingId: id, fromStatus: null, toStatus: status, notes: `Started (${opts.source})` }),
    ]),
  );
  return (await loadReading(id))!;
}

export interface UndoProgress {
  sessionId: string;
  restoreEnd: { page: number | null; percent: number | null; minutes: number | null; chapter: string | null } | null;
  repause: boolean;
  /** A stopped timer (SLN-451): how it was running, and the session a "fix my last log" changed */
  timer?: {
    pausedAt: string | null;
    pausedSeconds: number;
    fixedSessionId: string | null;
  } | null;
}

export interface ProgressResult {
  reading: ReadingWithFingerprint;
  session: Session;
  reachedEnd: boolean;
  wentBack: "fixed_last_log" | "went_back" | null;
  undo: UndoProgress;
  /** Pages this log added on its reading day, for the history entry */
  resumed: boolean;
}

/**
 * Records a log: a new session from where the order says to the new position,
 * or (going back by mistake) a corrected end of the latest session. With a
 * fingerprint (page dialogs) a changed reading fails; without one (REST, the
 * timer, the reader) the write is built from a fresh read, asserted, and
 * retried once.
 */
export async function recordProgress(
  raw: ProgressInput,
  opts: {
    fingerprint?: string;
    source: SessionSource;
    editionId?: string | null;
    format?: ReadingFormat;
  },
): Promise<ProgressResult> {
  const input = progressSchema.parse(raw);
  const attempt = async (): Promise<ProgressResult> => {
    const reading = await loadReading(input.readingId);
    if (!reading) throw new Error("This reading no longer exists");
    if (opts.fingerprint && reading.fingerprint !== opts.fingerprint) throw new Error(STALE_READING);
    if (!isOpenStatus(reading.status)) throw new Error("Reopen this reading to log progress");
    const sessions = await loadSessions(reading.id);
    const ordered = sessionOrder(sessions);
    // Stopping a timer completes its running row (SLN-451)
    const timer = input.timerSessionId ? (sessions.find((s) => s.id === input.timerSessionId) ?? null) : null;
    if (input.timerSessionId && (!timer || !isRunningTimer(timer))) throw new Error(TIMER_GONE);
    const sessionEditionId = opts.editionId === undefined ? reading.editionId : opts.editionId;
    let sessionPagesTotal = reading.totalPages;
    if (sessionEditionId && sessionEditionId !== reading.editionId) {
      const edition = await editionPages(sessionEditionId);
      if (!edition || edition.workId !== reading.workId) throw new Error("This edition belongs to another book");
      sessionPagesTotal = edition.pageCount ?? reading.totalPages;
    }
    const sessionTotals = { totalPages: sessionPagesTotal, totalMinutes: reading.totalMinutes };
    const current = currentOf(reading);
    // The new end, in the session's edition
    let given: { page?: number | null; percent?: number | null; minutes?: number | null } = {};
    if (input.addPages != null) {
      const from =
        sessionEditionId === reading.editionId
          ? (current.page ?? 0)
          : current.percent != null && sessionPagesTotal
            ? Math.round((current.percent / 100) * sessionPagesTotal)
            : 0;
      given = { page: from + input.addPages };
    } else if (input.addMinutes != null) given = { minutes: (current.minutes ?? 0) + input.addMinutes };
    else if (input.page != null) given = { page: input.page };
    else if (input.percent != null) given = { percent: input.percent };
    else if (input.minutes != null) given = { minutes: input.minutes };
    else given = sessionEditionId === reading.editionId ? { page: current.page, percent: current.percent, minutes: current.minutes } : { percent: current.percent };
    checkWithinTotals(given, sessionTotals);
    const end = completePosition(given, sessionTotals);
    const chapter = input.chapter ?? null;
    const now = new Date();
    // A timer keeps the zone and the reading day it started with
    const timeZone = timer ? timer.timeZone : (input.timeZone ?? appTimeZone());
    const readOn = timer ? timer.readOn : (input.readOn ?? readingDay(input.startedAt ?? now, timeZone, await readingDayStartHour()));
    // A session after today is the latest in the order and would hold the position until that day
    if (!timer) {
      const ahead = (at: Date | undefined) => !!at && at.getTime() - now.getTime() > 60_000;
      if (readOn > readingDay(now, timeZone, 0) || ahead(input.startedAt) || ahead(input.endedAt)) throw new Error(FUTURE_SESSION);
    }
    let stop: ReturnType<typeof stopTimes> | null = null;
    if (timer) {
      const clock = { startedAt: timer.startedAt ?? timer.createdAt, pausedAt: timer.pausedAt, pausedSeconds: timer.pausedSeconds };
      const [work] = await db.select({ title: works.title }).from(works).where(eq(works.id, reading.workId));
      const problem = stopProblem({ ...clock, title: work?.title ?? "this book" }, input.endedAt ?? null, (await getAppSettings()).readingTimerCheckMinutes, now);
      if (problem) throw new Error(problem);
      stop = stopTimes(clock, input.endedAt ?? null, now);
    }
    const latest = ordered.at(-1) ?? null;
    const behind = end.percent != null && current.percent != null && end.percent < current.percent;
    let mode: "new" | "fix" | "went_back" | "reader_behind" = "new";
    if (behind) {
      if (opts.source === "reader" && input.goingBack !== "went_back") mode = "reader_behind";
      else if (input.goingBack === "went_back") mode = "went_back";
      else if (input.goingBack === "fix_last_log") mode = latest ? "fix" : "went_back";
      else mode = latest && latest.readOn === readOn ? "fix" : "went_back";
    }
    const resumed = reading.status === "paused";
    let session: Session;
    let next: Session[];
    let undo: UndoProgress;
    // A stopped timer: its own row completes, after the fix of the latest log when there is one
    let timerRow: Session | null = null;
    if (timer) {
      timerRow = {
        ...timer,
        editionId: sessionEditionId ?? null,
        format: opts.format ?? timer.format,
        pagesTotal: sessionPagesTotal,
        endedAt: stop!.endedAt,
        durationSeconds: stop!.durationSeconds,
        pausedAt: null,
        pausedSeconds: stop!.pausedSeconds,
        endPage: end.page,
        endPercent: end.percent,
        endMinutes: end.minutes,
        endChapter: chapter,
        note: input.note ?? timer.note,
        updatedAt: now,
      };
    }
    if (mode === "fix") {
      session = {
        ...latest!,
        endPage: end.page,
        endPercent: end.percent,
        endMinutes: end.minutes,
        endChapter: chapter ?? latest!.endChapter,
        updatedAt: now,
      };
      next = ordered.map((s) => (s.id === session.id ? session : s));
      undo = {
        sessionId: latest!.id,
        restoreEnd: { page: latest!.endPage, percent: latest!.endPercent, minutes: latest!.endMinutes, chapter: latest!.endChapter },
        repause: resumed,
      };
      if (timerRow) {
        // The timer starts and ends at the corrected position: 0 pages, its time still counts
        next = sessionOrder([...next, timerRow]);
        undo = { ...undo, sessionId: timerRow.id, timer: { pausedAt: timer!.pausedAt?.toISOString() ?? null, pausedSeconds: timer!.pausedSeconds, fixedSessionId: latest!.id } };
      }
    } else if (timerRow) {
      session = timerRow;
      next = sessionOrder([...ordered, session]);
      undo = {
        sessionId: session.id,
        restoreEnd: null,
        repause: resumed,
        timer: { pausedAt: timer!.pausedAt?.toISOString() ?? null, pausedSeconds: timer!.pausedSeconds, fixedSessionId: null },
      };
    } else {
      session = {
        id: randomUUID(),
        readingId: reading.id,
        editionId: sessionEditionId ?? null,
        format: opts.format ?? reading.format,
        readOn,
        timeZone,
        startedAt: input.startedAt ?? null,
        endedAt: input.endedAt ?? null,
        durationSeconds: input.durationSeconds ?? null,
        startPage: null,
        endPage: end.page,
        startPercent: null,
        endPercent: end.percent,
        startMinutes: null,
        endMinutes: end.minutes,
        endChapter: chapter,
        pagesTotal: sessionPagesTotal,
        pagesRead: null,
        note: input.note ?? null,
        source: opts.source,
        pausedAt: null,
        pausedSeconds: 0,
        createdAt: now,
        updatedAt: now,
      };
      next = sessionOrder([...ordered, session]);
      undo = { sessionId: session.id, restoreEnd: null, repause: resumed };
    }
    const plan = planPositions(reading, next);
    const start = plan.starts.get(session.id)!;
    const queries = (d: Db) => [
      ...guardReading(d, reading.id, reading.fingerprint, opts.fingerprint ? STALE_READING : STALE_RETRY),
      // The timer is still running: another device did not stop it meanwhile
      ...(timerRow
        ? [
            d.execute(assertSql(sql`exists (select 1 from reading_sessions where id = ${timerRow.id}::uuid and ended_at is null)`, TIMER_GONE)),
            d
              .update(readingSessions)
              .set({
                editionId: timerRow.editionId,
                format: timerRow.format,
                pagesTotal: timerRow.pagesTotal,
                endedAt: timerRow.endedAt,
                durationSeconds: timerRow.durationSeconds,
                pausedAt: null,
                pausedSeconds: timerRow.pausedSeconds,
                endPage: timerRow.endPage,
                endPercent: timerRow.endPercent,
                endMinutes: timerRow.endMinutes,
                endChapter: timerRow.endChapter,
                note: timerRow.note,
                ...plan.starts.get(timerRow.id)!,
                updatedAt: now,
              })
              .where(eq(readingSessions.id, timerRow.id)),
          ]
        : []),
      timerRow && mode !== "fix"
        ? d.execute(sql`select 1`)
        : mode === "fix"
        ? d
            .update(readingSessions)
            .set({ endPage: session.endPage, endPercent: session.endPercent, endMinutes: session.endMinutes, endChapter: session.endChapter, ...start, updatedAt: now })
            .where(eq(readingSessions.id, session.id))
        : d.insert(readingSessions).values({
            ...session,
            ...start,
            pagesRead: undefined,
          } as typeof readingSessions.$inferInsert),
      ...startUpdates(
        d,
        next.filter((s) => s.id !== session.id && s.id !== timerRow?.id),
        plan.starts,
      ),
      d
        .update(readings)
        .set({
          ...positionValues(plan.position),
          status: "reading",
          // A backdated session does not make the book read today
          lastReadAt: next.at(-1)?.id === (timerRow?.id ?? session.id) || mode === "fix" ? now : reading.lastReadAt,
          updatedAt: now,
        })
        .where(eq(readings.id, reading.id)),
      ...(resumed
        ? [d.insert(readingStatusHistory).values({ readingId: reading.id, fromStatus: "paused", toStatus: "reading", notes: "Resumed by a progress log" })]
        : []),
    ];
    await withReadableErrors(() => atomic((d) => queries(d)));
    const fresh = (await loadReading(reading.id))!;
    const [stored] = await db.select().from(readingSessions).where(eq(readingSessions.id, timerRow?.id ?? session.id));
    return {
      reading: fresh,
      session: stored,
      reachedEnd: (end.percent ?? 0) >= 100,
      wentBack: mode === "fix" ? "fixed_last_log" : mode === "went_back" ? "went_back" : null,
      undo,
      resumed,
    };
  };
  if (opts.fingerprint) return attempt();
  try {
    return await attempt();
  } catch (err) {
    if (err instanceof Error && err.message === STALE_RETRY) return attempt();
    throw err;
  }
}

/** Recomputes session starts and an open reading's position after sessions changed */
export function recomputeQueries(d: Db, reading: Reading, sessions: Session[], now = new Date()) {
  const ordered = sessionOrder(sessions);
  const plan = planPositions(reading, ordered);
  return [
    ...startUpdates(d, ordered, plan.starts),
    d
      .update(readings)
      .set({
        ...(isOpenStatus(reading.status) ? positionValues(plan.position) : {}),
        updatedAt: now,
      })
      .where(eq(readings.id, reading.id)),
  ];
}

export { guardReading, loadSessions, positionValues, checkWithinTotals, completePosition, editionPages, openReadingOf };

export interface WriteOutcome {
  outcome: "written" | "already_present" | "possible_duplicate" | "refused";
  readingId?: string;
  match?: { readingId: string; reason: string };
  reason?: string;
  bookRating?: { before: number | null; after: number | null };
}

const CHUNK = 100;

/**
 * The batch writer for imports, the seed, the backfill and past reads: each
 * row validated with the action rules, checked against the duplicate rule,
 * and written with its history row, at most 100 per atomic. Idempotent: a
 * repeated run writes nothing it wrote before. Writes no sessions.
 */
export async function writeReadings(
  rawRows: WriteReadingRow[],
  opts: { source: ReadingSource; importId?: string | null },
): Promise<WriteOutcome[]> {
  const outcomes: (WriteOutcome | null)[] = rawRows.map(() => null);
  const parsed = rawRows.map((row, i) => {
    const result = writeReadingRowSchema.safeParse(row);
    if (!result.success) {
      outcomes[i] = { outcome: "refused", reason: result.error.issues[0]?.message ?? "Invalid row" };
      return null;
    }
    return result.data;
  });
  const books = await requireReadableWorks(parsed.filter(Boolean).map((r) => r!.workId));
  parsed.forEach((row, i) => {
    if (row && !books.has(row.workId)) {
      outcomes[i] = { outcome: "refused", reason: "Only books can be read" };
      parsed[i] = null;
    }
  });
  // Existing readings of every book in the batch
  const workIds = [...new Set(parsed.filter(Boolean).map((r) => r!.workId))];
  const existing = workIds.length
    ? await db
        .select({
          id: readings.id,
          workId: readings.workId,
          sourceKey: readings.sourceKey,
          status: readings.status,
          finishedOn: readings.finishedOn,
          finishedPrecision: readings.finishedPrecision,
        })
        .from(readings)
        .where(inArray(readings.workId, workIds))
    : [];
  const ratings = workIds.length
    ? new Map(
        (await db.select({ id: works.id, rating: works.rating }).from(works).where(inArray(works.id, workIds))).map((w) => [w.id, w.rating]),
      )
    : new Map<string, number | null>();
  // Duplicates per book, in row order
  for (const workId of workIds) {
    const indexes = parsed.map((r, i) => (r && r.workId === workId ? i : -1)).filter((i) => i >= 0);
    const verdicts = duplicateVerdicts(
      indexes.map((i) => ({
        readingId: parsed[i]!.readingId,
        sourceKey: parsed[i]!.sourceKey,
        status: parsed[i]!.status,
        finishedOn: parsed[i]!.finishedOn,
        finishedPrecision: parsed[i]!.finishedPrecision,
      })),
      existing.filter((e) => e.workId === workId) as ExistingReading[],
      { countRule: opts.source === "import" },
    );
    let openInBatch = false;
    const openExisting = existing.find((e) => e.workId === workId && isOpenStatus(e.status as ReadingStatus));
    indexes.forEach((i, k) => {
      const v = verdicts[k];
      const row = parsed[i]!;
      // An import's "Import anyway" writes an undated read the count rule called present
      const anyway = row.allowPossibleDuplicate && v.match?.reason === "Undated read";
      if (v.verdict === "already_present" && !anyway) outcomes[i] = { outcome: "already_present", match: v.match };
      else if (v.verdict === "possible_duplicate" && !row.allowPossibleDuplicate)
        outcomes[i] = { outcome: "possible_duplicate", match: v.match };
      else if (isOpenStatus(row.status)) {
        if (openExisting) outcomes[i] = { outcome: "refused", reason: "This book already has an open reading" };
        else if (openInBatch) outcomes[i] = { outcome: "refused", reason: "This book has another open reading in this batch" };
        else openInBatch = true;
      }
    });
  }
  // The rows to write
  const toWrite = parsed
    .map((row, i) => ({ row, i }))
    .filter((x): x is { row: NonNullable<typeof x.row>; i: number } => !!x.row && !outcomes[x.i]);
  for (let at = 0; at < toWrite.length; at += CHUNK) {
    const chunk = toWrite.slice(at, at + CHUNK).map(({ row, i }) => {
      const id = randomUUID();
      const totals = { totalPages: row.totalPages ?? null, totalMinutes: row.totalMinutes ?? null };
      const pos = row.position ?? null;
      const known = pos && [pos.page, pos.percent, pos.minutes].some((v) => v != null);
      if (known) checkWithinTotals(pos!, totals);
      const position = known ? completePosition(pos!, totals) : null;
      const finished = row.status === "finished";
      const startedOn = row.startedOn && row.startedPrecision !== "unknown" ? readingPeriodStart(row.startedOn, row.startedPrecision) : null;
      const finishedOn = row.finishedOn && row.finishedPrecision !== "unknown" ? readingPeriodStart(row.finishedOn, row.finishedPrecision) : null;
      const current = finished
        ? { page: totals.totalPages, percent: 100, minutes: totals.totalMinutes }
        : (position ?? { page: null, percent: null, minutes: null });
      const before = ratings.get(row.workId) ?? null;
      let bookRating: WriteOutcome["bookRating"];
      if (row.rating != null) {
        const after = row.bookRating === "replace" || before == null ? row.rating : before;
        bookRating = { before, after };
        ratings.set(row.workId, after);
      }
      return { id, row, i, totals, position, current, startedOn, finishedOn, bookRating };
    });
    await withReadableErrors(() =>
      atomic((d) =>
        chunk.flatMap(({ id, row, totals, position, current, startedOn, finishedOn, bookRating }) => [
          // A row whose key arrived meanwhile is skipped, so the chunk can be repeated
          d
            .insert(readings)
            .values({
              id,
              workId: row.workId,
              editionId: row.editionId ?? null,
              instanceId: row.instanceId ?? null,
              locationId: row.locationId ?? null,
              format: row.format,
              status: row.status,
              startedOn,
              startedPrecision: startedOn ? row.startedPrecision : "unknown",
              finishedOn,
              finishedPrecision: finishedOn ? row.finishedPrecision : "unknown",
              unit: row.unit ?? (row.format === "audio" ? "minutes" : "pages"),
              ...totals,
              startPage: position?.page ?? null,
              startPercent: position?.percent ?? null,
              startMinutes: position?.minutes ?? null,
              currentPage: current.page,
              currentPercent: current.percent,
              currentMinutes: current.minutes,
              currentChapter: row.position?.chapter ?? null,
              rating: row.rating ?? null,
              reviewHtml: row.reviewHtml ? sanitizeCommentHtml(row.reviewHtml) : null,
              reviewJson: row.reviewJson ?? null,
              abandonReason: row.status === "abandoned" ? (row.abandonReason ?? null) : null,
              abandonNote: row.status === "abandoned" ? (row.abandonNote ?? null) : null,
              source: opts.source,
              importId: opts.importId ?? null,
              sourceKey: row.sourceKey ?? null,
            })
            .onConflictDoNothing({ target: readings.sourceKey }),
          d.execute(sql`insert into reading_status_history (reading_id, from_status, to_status, notes)
            select id, null, status, ${`Written (${opts.source})`} from readings where id = ${id}::uuid`),
          ...(bookRating && bookRating.after !== bookRating.before
            ? [d.update(works).set({ rating: bookRating.after, updatedAt: new Date() }).where(eq(works.id, row.workId))]
            : []),
        ]),
      ),
    );
    // What each row became: written, or already there under its key
    const keys = chunk.map((c) => c.row.sourceKey).filter((k): k is string => !!k);
    const keyed = keys.length
      ? new Map(
          (await db.select({ id: readings.id, key: readings.sourceKey }).from(readings).where(inArray(readings.sourceKey, keys))).map((r) => [r.key, r.id]),
        )
      : new Map<string | null, string>();
    for (const c of chunk) {
      const keyedId = c.row.sourceKey ? keyed.get(c.row.sourceKey) : undefined;
      outcomes[c.i] =
        keyedId && keyedId !== c.id
          ? { outcome: "already_present", match: { readingId: keyedId, reason: "Same source" } }
          : { outcome: "written", readingId: c.id, ...(c.bookRating ? { bookRating: c.bookRating } : {}) };
    }
  }
  return outcomes.map((o) => o ?? { outcome: "refused", reason: "Not written" });
}

/** A book's readings as the duplicate rule reads them */
export async function existingReadings(workId: string): Promise<ExistingReading[]> {
  return db
    .select({
      id: readings.id,
      sourceKey: readings.sourceKey,
      status: readings.status,
      finishedOn: readings.finishedOn,
      finishedPrecision: readings.finishedPrecision,
    })
    .from(readings)
    .where(eq(readings.workId, workId));
}

/** The pages counted on one reading day of one reading */
export async function pagesOnDay(readingId: string, day: string) {
  const { countedPagesSql } = await import("./summary");
  const [row] = resultRows<{ pages: number | null }>(
    await db.execute(sql`select sum(c.pages)::float8 as pages from ${countedPagesSql()} c where c.reading_id = ${readingId}::uuid and c.day = ${day}::date`),
  );
  return Math.round(row?.pages ?? 0);
}
