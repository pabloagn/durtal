"use server";

import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { recommendationFeedback } from "@/lib/db/schema";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { requireBookWork } from "@/lib/catalogue/book-boundary";
import { readingToday } from "@/lib/reading/day";
import { addDays } from "@/lib/reading/goals";
import { NOT_NOW_DAYS } from "@/lib/reading/suggest/score";
import {
  setSuggestionFeedbackSchema,
  suggestionFeedbackSnapshotSchema,
  suggestionWorkSchema,
  type SuggestionFeedbackSnapshot,
} from "@/lib/validations/suggestions";

/*
 * Suggestion feedback (SLN-457): Not now, Never and Not for me, in
 * recommendation_feedback (one row a book, shared with the book enrichment
 * epic). Every write is an upsert on work_id: the newer verdict replaces the
 * older; reasons, note and until are replaced, not merged; source becomes
 * "suggestions". Each returns what Undo needs.
 */

const columns = {
  id: recommendationFeedback.id,
  workId: recommendationFeedback.workId,
  verdict: recommendationFeedback.verdict,
  reasons: recommendationFeedback.reasons,
  note: recommendationFeedback.note,
  until: recommendationFeedback.until,
  source: recommendationFeedback.source,
  createdAt: recommendationFeedback.createdAt,
  updatedAt: recommendationFeedback.updatedAt,
};

type Row = typeof recommendationFeedback.$inferSelect;

function snapshot(row: Pick<Row, keyof typeof columns>): SuggestionFeedbackSnapshot {
  return suggestionFeedbackSnapshotSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

async function current(workId: string) {
  const [row] = await db.select(columns).from(recommendationFeedback).where(eq(recommendationFeedback.workId, workId));
  return row ? snapshot(row) : null;
}

/** Records a verdict on a book, replacing the one before; returns the row it replaced (null when none), for Undo */
export async function setSuggestionFeedback(input: z.input<typeof setSuggestionFeedbackSchema>): Promise<SuggestionFeedbackSnapshot | null> {
  const data = setSuggestionFeedbackSchema.parse(input);
  await requireBookWork(data.workId);
  const previous = await current(data.workId);
  const until = data.verdict === "not_now" ? (data.until ?? addDays(await readingToday(), NOT_NOW_DAYS)) : null;
  const now = new Date();
  const values = { verdict: data.verdict, reasons: data.reasons, note: data.note, until, source: "suggestions" as const, updatedAt: now };
  await withReadableErrors(() =>
    atomic((d) => [
      d
        .insert(recommendationFeedback)
        .values({ workId: data.workId, ...values })
        .onConflictDoUpdate({ target: recommendationFeedback.workId, set: values }),
    ]),
  );
  invalidate(CACHE_TAGS.reading);
  return previous;
}

/** Removes a book's verdict (Undo in the Hidden view): it is a candidate again. Returns the row, or null */
export async function removeSuggestionFeedback(input: z.input<typeof suggestionWorkSchema>): Promise<SuggestionFeedbackSnapshot | null> {
  const { workId } = suggestionWorkSchema.parse(input);
  await requireBookWork(workId);
  const previous = await current(workId);
  if (!previous) return null;
  await withReadableErrors(() => atomic((d) => [d.delete(recommendationFeedback).where(eq(recommendationFeedback.workId, workId))]));
  invalidate(CACHE_TAGS.reading);
  return previous;
}

/** Puts a previous row back as it was (the Undo of a verdict that replaced it, or of a removal) */
export async function restoreSuggestionFeedback(input: z.input<typeof suggestionFeedbackSnapshotSchema>) {
  const row = suggestionFeedbackSnapshotSchema.parse(input);
  await requireBookWork(row.workId);
  await withReadableErrors(() =>
    atomic((d) => [
      d.delete(recommendationFeedback).where(eq(recommendationFeedback.workId, row.workId)),
      d.insert(recommendationFeedback).values({ ...row, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) }),
    ]),
  );
  invalidate(CACHE_TAGS.reading);
  return { workId: row.workId };
}
