"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { readings, works } from "@/lib/db/schema";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { requireBookWorks } from "@/lib/catalogue/book-boundary";
import { formatOfCopies, type ReadingDatePrecision, type ReadingStatus } from "@/lib/reading/constants";
import { readingEvent } from "@/lib/reading/activity";
import { readingStateSql } from "@/lib/reading/summary";
import { writeReadings, type WriteOutcome } from "@/lib/reading/service";
import {
  markWorksReadSchema,
  undoMarkWorksReadSchema,
  type MarkWorksReadInput,
  type UndoMarkWorksReadInput,
  type WriteReadingRow,
} from "@/lib/validations/reading";

/*
 * Bulk Mark as read from the library's selection (SLN-463). A reading comes
 * only from his click (R7): each book gets one finished reading, dates
 * unknown, source manual, no key. A possible duplicate is written only when
 * he confirms that book; the Undo removes only what one call wrote.
 */

/** writeReadings' own chunk: one call per chunk is one atomic, so the books of a failed call are not written */
const CHUNK = 100;

export interface PossibleDuplicate {
  workId: string;
  title: string;
  match: { readingId: string; status: ReadingStatus; finishedOn: string | null; finishedPrecision: ReadingDatePrecision } | null;
}

export interface SkippedBook {
  workId: string;
  title: string;
  reason: string;
}

/** Marks the selected books read: one finished reading each, dates unknown */
export async function markWorksRead(input: MarkWorksReadInput) {
  const data = markWorksReadSchema.parse(input);
  const ids = [...new Set(data.workIds)];
  const confirmed = new Set(data.confirmDuplicates ?? []);
  await requireBookWorks(ids);
  // Each book's state, and the formats of its copies that are not deaccessioned
  const books = await db
    .select({
      id: works.id,
      title: works.title,
      state: readingStateSql(sql`works.id`),
      formats: sql<(string | null)[]>`array(select i.format from editions e join instances i on i.edition_id = e.id
        where e.work_id = works.id and i.status <> 'deaccessioned')`,
    })
    .from(works)
    .where(inArray(works.id, ids));
  const byId = new Map(books.map((b) => [b.id, b]));
  const skipped: SkippedBook[] = [];
  const rows: WriteReadingRow[] = [];
  for (const id of ids) {
    const book = byId.get(id)!;
    if (book.state === "reading" || book.state === "paused") {
      skipped.push({ workId: id, title: book.title, reason: "being read: finish it on the book page" });
      continue;
    }
    rows.push({
      workId: id,
      format: formatOfCopies(book.formats),
      status: "finished",
      startedPrecision: "unknown",
      finishedPrecision: "unknown",
      ...(confirmed.has(id) ? { allowPossibleDuplicate: true } : {}),
    });
  }
  const readingIds: string[] = [];
  const duplicates: { workId: string; readingId: string | null }[] = [];
  try {
    for (let at = 0; at < rows.length; at += CHUNK) {
      const chunk = rows.slice(at, at + CHUNK);
      const outcomes: WriteOutcome[] = await writeReadings(chunk, { source: "manual" });
      outcomes.forEach((outcome, k) => {
        const workId = chunk[k].workId;
        if (outcome.outcome === "written") {
          readingIds.push(outcome.readingId!);
          readingEvent(workId, "work.reading_finished", { id: outcome.readingId! }, { rating: null, past: true });
        } else if (outcome.outcome === "possible_duplicate") duplicates.push({ workId, readingId: outcome.match?.readingId ?? null });
        else skipped.push({ workId, title: byId.get(workId)!.title, reason: outcome.reason ?? outcome.match?.reason ?? "Not written" });
      });
    }
  } catch (error) {
    // The chunks before the failure are written and recorded: the same selection again marks the rest
    if (readingIds.length) invalidate(CACHE_TAGS.works, CACHE_TAGS.reading);
    const done = readingIds.length ? `Marked ${readingIds.length} before an error. Mark the same books again for the rest. ` : "";
    throw new Error(`${done}${error instanceof Error ? error.message : "The books could not be marked"}`, { cause: error });
  }
  // The read each possible duplicate matches: "already read: finished 14 Apr 2019"
  const matchIds = duplicates.map((d) => d.readingId).filter((id): id is string => !!id);
  const matches = matchIds.length
    ? new Map(
        (
          await db
            .select({ id: readings.id, status: readings.status, finishedOn: readings.finishedOn, finishedPrecision: readings.finishedPrecision })
            .from(readings)
            .where(inArray(readings.id, matchIds))
        ).map((r) => [r.id, r]),
      )
    : new Map();
  const possibleDuplicates: PossibleDuplicate[] = duplicates.map((d) => {
    const m = d.readingId ? matches.get(d.readingId) : undefined;
    return {
      workId: d.workId,
      title: byId.get(d.workId)!.title,
      match: m ? { readingId: m.id, status: m.status as ReadingStatus, finishedOn: m.finishedOn, finishedPrecision: m.finishedPrecision as ReadingDatePrecision } : null,
    };
  });
  if (readingIds.length) invalidate(CACHE_TAGS.works, CACHE_TAGS.reading);
  return { marked: readingIds.length, readingIds, possibleDuplicates, skipped };
}

/**
 * A reading as Mark as read wrote it: manual, no key, finished with both
 * dates unknown, unchanged since (the import undo's rule, SLN-450) and with
 * no session. Raw names: a subquery's own id must not stand for the reading's.
 */
const asMarked = sql`(readings.source = 'manual' and readings.source_key is null and readings.status = 'finished'
  and readings.started_precision = 'unknown' and readings.finished_precision = 'unknown'
  and readings.updated_at = readings.created_at
  and not exists (select 1 from reading_sessions s where s.reading_id = readings.id))`;

/** Removes the readings one Mark as read wrote, unless they changed since */
export async function undoMarkWorksRead(input: UndoMarkWorksReadInput) {
  const ids = [...new Set(undoMarkWorksReadSchema.parse(input).readingIds)];
  const found = await db
    .select({
      id: readings.id,
      workId: readings.workId,
      title: works.title,
      removable: sql<boolean>`${asMarked}`,
      hasSession: sql<boolean>`exists (select 1 from reading_sessions s where s.reading_id = readings.id)`,
    })
    .from(readings)
    .innerJoin(works, eq(works.id, readings.workId))
    .where(inArray(readings.id, ids));
  const removable = found.filter((r) => r.removable);
  const removed: { id: string; workId: string }[] = [];
  for (let at = 0; at < removable.length; at += CHUNK) {
    const chunk = removable.slice(at, at + CHUNK).map((r) => r.id);
    const [deleted] = (await withReadableErrors(() =>
      atomic((d) => [d.delete(readings).where(and(inArray(readings.id, chunk), asMarked)).returning({ id: readings.id, workId: readings.workId })]),
    )) as { id: string; workId: string }[][];
    removed.push(...deleted);
  }
  const gone = new Set(removed.map((r) => r.id));
  for (const r of removed) readingEvent(r.workId, "work.reading_deleted", { id: r.id }, { undo: true });
  // A reading changed since it was marked stays, with its reason
  const kept = found
    .filter((r) => !gone.has(r.id))
    .map((r) => ({ readingId: r.id, workId: r.workId, title: r.title, reason: r.hasSession ? "a session was logged since" : "it changed since it was marked" }));
  if (removed.length) invalidate(CACHE_TAGS.works, CACHE_TAGS.reading);
  return { removed: removed.length, kept };
}
