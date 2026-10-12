import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { databaseErrorCode } from "@/lib/db/errors";
import type { READER_RECEIPT_RETIRE_REASONS } from "@/lib/db/schema/reader-tracking";

type Db = typeof db;
type RetireReason = (typeof READER_RECEIPT_RETIRE_REASONS)[number];
const uuidArray = (ids: SQL) => sql`array(${ids})::uuid[]`;

/** Actual 0087/0083 protocol, before note row DML, inside the caller's atomic batch. */
export function lockReaderNotes(d: Db, noteIds: SQL, annotationIds: SQL = sql`select null::uuid where false`) {
  return d.execute(sql`select public.durtal_reader_lock_quote_notes(${uuidArray(noteIds)}, ${uuidArray(annotationIds)})`);
}

/** Includes unannotated books: a concurrent first quote also takes the book lock. */
export function lockReaderEbooks(d: Db, ebookIds: SQL) {
  return d.execute(sql`select public.durtal_reader_lock_quote_ebooks(${uuidArray(ebookIds)})`);
}

/** Discover the complete book set before taking any annotation/note locks. */
export function lockReaderBindings(d: Db, ebookIds: SQL, noteIds: SQL) {
  return d.execute(readerBindingsLockSql(ebookIds, noteIds));
}

export function readerBindingsLockSql(ebookIds: SQL, noteIds: SQL) {
  const ids = sql`select id from (${ebookIds}) explicit_books(id)
    union select a.ebook_id from ebook_annotations a join reading_notes n on n.ebook_annotation_id=a.id
      where n.id in (${noteIds})`;
  return sql`select public.durtal_reader_lock_quote_ebooks(${uuidArray(ids)})`;
}

export const notesForReading = (id: string) => sql`select id from reading_notes where reading_id=${id}::uuid`;
export const notesForEdition = (id: string) => sql`select id from reading_notes where edition_id=${id}::uuid`;
export const ebooksForEdition = (id: string) => sql`select eb.id from ebooks eb join instances i on i.id=eb.instance_id where i.edition_id=${id}::uuid`;
export const ebooksForWork = (id: string) => sql`select eb.id from ebooks eb join instances i on i.id=eb.instance_id join editions e on e.id=i.edition_id where e.work_id=${id}::uuid`;

/** Explicit user intent, including a no-op edit. Never delete or reactivate receipts. */
export function retireReaderSittings(d: Db, readingId: string, reason: RetireReason) {
  return d.execute(sql`update reader_sitting_receipts set session_id=null, state='retired',
    retired_at=clock_timestamp(), retire_reason=${reason}
    where reading_id=${readingId}::uuid and state='active'`);
}

/** Re-run discovery and planning, not just the failed statements. No retry of conflicts. */
export async function withReaderWriteRetry<T>(planAndWrite: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await planAndWrite(); }
    catch (error) {
      if (attempt >= 2 || !["40P01", "40001"].includes(databaseErrorCode(error) ?? "")) throw error;
    }
  }
}
