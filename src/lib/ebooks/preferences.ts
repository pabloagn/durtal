import { z } from "zod/v4";
import { asc, count, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { readerPreferences } from "@/lib/db/schema/reader-preferences";
import { ebooks } from "@/lib/db/schema/ebooks";
import { databaseErrorCode, readableDatabaseError } from "@/lib/db/errors";
import { preferenceListSchema, preferenceReadSchema, scopedPreferenceRows } from "@/lib/reader/presentation/preference-plan";
import type { PresentationRow } from "@/lib/reader/presentation/defaults";

export const READER_OVERRIDE_PAGE_SIZE = 50;
export type ReaderPreferencesRead =
  | { ok: true; ebookId: string | null; rows: readonly PresentationRow[] }
  | { ok: false; error: string };

/** Safe UI messages, never an ORM query/parameters or a silently missing migration. */
export function preferenceErrorMessage(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "Invalid reading settings.";
  if (databaseErrorCode(error) === "42P01") return "Reader preferences are not available until their database migration is installed.";
  const readable = readableDatabaseError(error, { reference: "This eBook is no longer available." });
  if (readable !== error && readable instanceof Error) return readable.message;
  return "Reading settings could not be saved. Try again when you are online.";
}

/** Unevaluated query: actions also put this read last in their atomic batch. */
export function readerPreferenceRowsQuery(on: typeof db, ebookId: string | null) {
  return on.select({ deviceClass: readerPreferences.deviceClass, ebookId: readerPreferences.ebookId, presentation: readerPreferences.presentation })
    .from(readerPreferences)
    .where(ebookId === null ? isNull(readerPreferences.ebookId) : or(isNull(readerPreferences.ebookId), eq(readerPreferences.ebookId, ebookId)))
    .orderBy(asc(readerPreferences.deviceClass), asc(readerPreferences.ebookId)).limit(6);
}

export async function readerPreferenceRows(ebookId: string | null) {
  return readerPreferenceRowsQuery(db, ebookId);
}

export async function readerPreferenceBookExists(ebookId: string): Promise<boolean> {
  return (await db.select({ id: ebooks.id }).from(ebooks).where(eq(ebooks.id, ebookId)).limit(1)).length === 1;
}

/** Initial page read: three defaults and only this book's three possible overrides. */
export async function getReaderPreferences(ebookId: string | null): Promise<ReaderPreferencesRead> {
  try {
    const input = preferenceReadSchema.parse({ ebookId });
    if (input.ebookId !== null && !await readerPreferenceBookExists(input.ebookId)) return { ok: false, error: "This eBook is no longer available." };
    return { ok: true, ebookId: input.ebookId, rows: scopedPreferenceRows(await readerPreferenceRows(input.ebookId), input.ebookId) };
  } catch (error) {
    return { ok: false, error: preferenceErrorMessage(error) };
  }
}

/** One bounded Settings page. The join prevents a query per title. */
export async function getReaderBookOverrides(input: unknown) {
  try {
    const value = preferenceListSchema.parse(input);
    const where = eq(readerPreferences.deviceClass, value.deviceClass);
    const [rows, totals] = await Promise.all([
      db.select({ ebookId: ebooks.id, title: ebooks.title, presentation: readerPreferences.presentation })
        .from(readerPreferences).innerJoin(ebooks, eq(readerPreferences.ebookId, ebooks.id))
        .where(where).orderBy(asc(ebooks.title), asc(ebooks.id))
        .limit(READER_OVERRIDE_PAGE_SIZE).offset((value.page - 1) * READER_OVERRIDE_PAGE_SIZE),
      db.select({ total: count() }).from(readerPreferences).innerJoin(ebooks, eq(readerPreferences.ebookId, ebooks.id)).where(where),
    ]);
    return { ok: true as const, deviceClass: value.deviceClass, page: value.page, pageSize: READER_OVERRIDE_PAGE_SIZE, total: totals[0]?.total ?? 0, rows };
  } catch (error) {
    return { ok: false as const, error: preferenceErrorMessage(error) };
  }
}
