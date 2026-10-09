import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { databaseErrorCode, uniqueConstraint, withReadableErrors } from "@/lib/db/errors";
import { ebooks, editions, instances, readings, readingSessions, readingStatusHistory, readerSittingReceipts, works } from "@/lib/db/schema";
import { assertSql } from "@/lib/harmonization/store";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { readingDay } from "./dates";
import { readingDayStartHour } from "./day";
import { remapPosition } from "./positions";
import { loadReading, loadSessions, planPositions, positionValues, readingFingerprintSql, sessionOrder, type Session } from "./service";
import { canMergeReaderSitting, decideSittingReceipt, type SittingReceipt } from "./reader-receipts";
import { lockReaderEbooks } from "./reader-write-locks";
import type { ReaderSessionSnapshot } from "@/lib/validations/reader-tracking";

const REPLAN = "Reader sitting changed concurrently; retry";
export class ReaderTrackingConflict extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}
export interface ReaderSittingAck {
  sittingId: string;
  revision: number;
  status: "saved" | "replayed" | "retired";
  sessionId: string | null;
}
type ReceiptRow = typeof readerSittingReceipts.$inferSelect;
const receiptPolicy = (row: ReceiptRow): SittingReceipt => ({ ...row, retired: row.state === "retired" });
const ack = (input: ReaderSessionSnapshot, status: ReaderSittingAck["status"], row: ReceiptRow): ReaderSittingAck =>
  ({ sittingId: input.sittingId, revision: row.revision, status, sessionId: row.sessionId });

export async function readerBookBinding(ebookId: string) {
  const [binding] = await db.select({ ebookId: ebooks.id, instanceId: instances.id, editionId: editions.id,
    workId: works.id, totalPages: editions.pageCount })
    .from(ebooks).innerJoin(instances, eq(instances.id, ebooks.instanceId))
    .innerJoin(editions, eq(editions.id, instances.editionId)).innerJoin(works, eq(works.id, editions.workId))
    .where(and(eq(ebooks.id, ebookId), eq(ebooks.matchState, "linked"), eq(works.kind, "book")));
  return binding ?? null;
}

/** Cumulative receipts, never repeated beacon deltas. Discovery is retried in full.
 * Driver-independent atomic batches contain no awaited reads or dynamic callback.
 */
export async function saveReaderSitting(input: ReaderSessionSnapshot, owner: { ebookId: string; deviceId: string }): Promise<ReaderSittingAck> {
  for (let attempt = 0; ; attempt++) {
    try { return await saveOnce(input, owner); }
    catch (error) {
      const retry = ["40P01", "40001"].includes(databaseErrorCode(error) ?? "") ||
        (error instanceof Error && error.message === REPLAN) ||
        uniqueConstraint(error) === "reader_sitting_receipts_pkey";
      if (!retry || attempt >= 2) throw error;
    }
  }
}

async function saveOnce(input: ReaderSessionSnapshot, owner: { ebookId: string; deviceId: string }): Promise<ReaderSittingAck> {
  // This lookup precedes binding, reading and session lookup, including after deletion.
  const [existing] = await db.select().from(readerSittingReceipts).where(eq(readerSittingReceipts.sittingId, input.sittingId));
  const decision = decideSittingReceipt(existing ? receiptPolicy(existing) : null, input, owner);
  if (decision.kind === "refuse") throw new ReaderTrackingConflict(`Reader sitting refused: ${decision.reason}`);
  if (decision.kind === "ignore") return ack(input, decision.reason, existing!);
  const [binding, reading, dayHour] = await Promise.all([
    readerBookBinding(owner.ebookId), loadReading(input.readingId), readingDayStartHour(),
  ]);
  if (!binding) throw new ReaderTrackingConflict("This eBook is not linked to a book", 404);
  if (!reading || reading.workId !== binding.workId)
    throw new ReaderTrackingConflict("This eBook's reading binding changed; reload the reader");
  // A pause retired the previous sitting. Only a new identity reaches this path.
  // SLN-454 resumes an open paused reading on its first newly saved sitting.
  if (reading.status !== "reading" && reading.status !== "paused") throw new ReaderTrackingConflict("This reading is no longer open");
  const sessions = sessionOrder(await loadSessions(reading.id));
  const all = await db.select().from(readerSittingReceipts).where(eq(readerSittingReceipts.readingId, reading.id));
  let canonical = existing ? sessions.find((s) => s.id === existing.sessionId) : undefined;
  if (existing && !canonical) throw new ReaderTrackingConflict("This reader session no longer exists");
  if (!existing) {
    const last = sessions.at(-1);
    const owned = last ? all.filter((r) => r.originalSessionId === last.id) : [];
    if (last && owned.length && owned.every((r) => r.state === "active" && r.sessionId === last.id && r.ebookId === owner.ebookId) &&
      canMergeReaderSitting({ readingId: last.readingId, sessionId: last.id, source: last.source, endedAt: last.endedAt,
        format: last.format, editionId: last.editionId, durationSeconds: last.durationSeconds, retired: false, edited: false }, input, binding.editionId)) canonical = last;
  }
  const sessionId = canonical?.id ?? input.sittingId;
  const owned = all.filter((r) => r.sessionId === sessionId && r.state === "active" && r.sittingId !== input.sittingId);
  if (owned.some((r) => r.ebookId !== owner.ebookId || r.startedAt < input.endedAt && input.startedAt < r.endedAt))
    throw new ReaderTrackingConflict("This sitting overlaps another reader sitting; reload before saving");
  const receipt: ReceiptRow = {
    ...input, ebookId: owner.ebookId, deviceId: owner.deviceId, originalSessionId: sessionId, sessionId,
    goingBack: input.goingBack === "went_back", state: "active", retiredAt: null, retireReason: null, updatedAt: new Date(),
  };
  const cumulative = [...owned, receipt].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() ||
    (a.sittingId < b.sittingId ? -1 : a.sittingId > b.sittingId ? 1 : 0));
  const first = cumulative[0], last = cumulative.at(-1)!;
  const durationSeconds = cumulative.reduce((sum, r) => sum + r.activeSeconds, 0);
  if (durationSeconds > 86_400) throw new ReaderTrackingConflict("This reader session exceeds one day");
  const now = new Date();
  const mapped = remapPosition(last.endPercent, { totalPages: binding.totalPages ?? reading.totalPages, totalMinutes: null });
  const session: Session = {
    ...(canonical ?? {
      id: sessionId, readingId: reading.id, editionId: binding.editionId, format: "ebook", source: "reader",
      readOn: readingDay(first.startedAt, first.timeZone, dayHour), timeZone: first.timeZone,
      startPage: null, startPercent: null, startMinutes: null, pagesRead: null, pagesTotal: binding.totalPages ?? reading.totalPages,
      note: null, pausedAt: null, pausedSeconds: 0, createdAt: now,
    }),
    startedAt: first.startedAt, endedAt: new Date(Math.max(...cumulative.map((r) => r.endedAt.getTime()))),
    durationSeconds, endPage: mapped.page, endPercent: last.endPercent, endMinutes: null, endChapter: last.endChapter,
    updatedAt: now, readerWentBack: cumulative.some((r) => r.goingBack),
  };
  const next = sessionOrder([...sessions.filter((s) => s.id !== sessionId), session]);
  const positions = planPositions(reading, next);
  const start = positions.starts.get(sessionId)!;
  const { readerWentBack: _back, pagesRead: _pages, ...storedSession } = session;
  await withReadableErrors(() => atomic((d) => [
    lockReaderEbooks(d, sql`select ${owner.ebookId}::uuid`),
    d.execute(sql`select id from readings where id=${reading.id}::uuid for update`),
    d.execute(assertSql(sql`coalesce((${readingFingerprintSql(reading.id)})=${reading.fingerprint},false)`, REPLAN)),
    d.execute(assertSql(sql`not exists(select 1 from reading_sessions where reading_id=${reading.id}::uuid
      and source='timer' and started_at < ${input.endedAt} and coalesce(ended_at,'infinity'::timestamptz) > ${input.startedAt})`,
    "A manual timer covers this sitting; stop the timer before using reader tracking")),
    d.execute(assertSql(sql`exists(select 1 from ebooks eb join instances i on i.id=eb.instance_id
      join editions e on e.id=i.edition_id where eb.id=${owner.ebookId}::uuid and eb.match_state='linked'
      and i.id=${binding.instanceId}::uuid and e.id=${binding.editionId}::uuid and e.work_id=${reading.workId}::uuid)`, REPLAN)),
    d.execute(sql`select pg_advisory_xact_lock(hashtext(${input.sittingId}),454)`),
    d.execute(sql`select sitting_id from reader_sitting_receipts where sitting_id=${input.sittingId}::uuid for update`),
    d.execute(assertSql(existing
      ? sql`exists(select 1 from reader_sitting_receipts where sitting_id=${input.sittingId}::uuid
          and state='active' and session_id=${sessionId}::uuid and revision=${existing.revision})`
      : sql`not exists(select 1 from reader_sitting_receipts where sitting_id=${input.sittingId}::uuid)`, REPLAN)),
    // Also fences extension against an explicit no-op edit of a canonical session.
    ...(canonical ? [d.execute(sql`select id from reading_sessions where id=${sessionId}::uuid for update`),
      d.execute(assertSql(sql`not exists(select 1 from reader_sitting_receipts where original_session_id=${sessionId}::uuid and state='retired')`, REPLAN))] :
      [d.insert(readingSessions).values({ ...storedSession, ...start })]),
    existing
      ? d.update(readerSittingReceipts).set({ revision: input.revision, endedAt: input.endedAt, activeSeconds: input.activeSeconds,
          endPercent: input.endPercent, endChapter: input.endChapter }).where(eq(readerSittingReceipts.sittingId, input.sittingId))
      : d.insert(readerSittingReceipts).values(receipt),
    d.execute(sql`select set_config('durtal.reader_tracking_session', ${sessionId}, true)`),
    ...(canonical ? [d.update(readingSessions).set({ ...start, endedAt: session.endedAt, durationSeconds,
      endPage: session.endPage, endPercent: session.endPercent, endMinutes: null, endChapter: session.endChapter, updatedAt: now })
      .where(eq(readingSessions.id, sessionId))] : []),
    ...next.filter((s) => s.id !== sessionId).flatMap((s) => {
      const value = positions.starts.get(s.id)!;
      return value.startPage === s.startPage && value.startPercent === s.startPercent && value.startMinutes === s.startMinutes ? [] :
        [d.update(readingSessions).set({ ...value, updatedAt: now }).where(eq(readingSessions.id, s.id))];
    }),
    d.update(readings).set({ ...positionValues(positions.position), status: "reading", lastReadAt: next.at(-1)?.id === sessionId ? session.endedAt : reading.lastReadAt,
      updatedAt: now }).where(eq(readings.id, reading.id)),
    d.execute(sql`select set_config('durtal.reader_tracking_session', '', true)`),
    ...(reading.status === "paused" ? [d.insert(readingStatusHistory).values({ readingId: reading.id, fromStatus: "paused", toStatus: "reading", notes: "Resumed by a reader sitting" })] : []),
  ]));
  invalidate(CACHE_TAGS.reading, CACHE_TAGS.works);
  return ack(input, "saved", receipt);
}
