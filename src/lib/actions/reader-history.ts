"use server";

import { z } from "zod/v4";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { imports } from "@/lib/db/schema";
import { assertSql, resultRows } from "@/lib/harmonization/store";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { readReaderSettings } from "@/lib/reader/settings-request";
import { appTimeZone } from "@/lib/utils/date";
import { proposeEbookReading } from "@/lib/reading/ebook-backfill";
import { readerReadingKey } from "@/lib/reading/source-keys";
import { writeReadings } from "@/lib/reading/service";
import { lockReaderBindings, lockReaderEbooks, lockReaderNotes, withReaderWriteRetry } from "@/lib/reading/reader-write-locks";

interface LegacyRow {
  ebookId: string; workId: string; editionId: string; instanceId: string;
  title: string; totalPages: number | null; fraction: number | null;
  startedAt: string | null; lastReadAt: string | null; finishedAt: string | null;
  hasOpenReading: boolean; imported: boolean; fingerprint: string;
}
const legacyRows = (ids?: string[]) => db.execute(sql`
  select eb.id as "ebookId", w.id as "workId", e.id as "editionId", i.id as "instanceId", w.title,
    e.page_count as "totalPages", l.progress_fraction as fraction,
    l.started_at as "startedAt", l.last_read_at as "lastReadAt", l.finished_at as "finishedAt",
    exists(select 1 from readings r where r.work_id=w.id and r.status in ('reading','paused')) as "hasOpenReading",
    exists(select 1 from readings r where r.source_key='reader:' || eb.id::text) as imported,
    md5(to_jsonb(l)::text || i.id::text || e.id::text || w.id::text || coalesce(e.page_count::text,'')) as fingerprint
  from legacy_reader_progress l join ebooks eb on eb.id=l.ebook_id
  join instances i on i.id=eb.instance_id join editions e on e.id=i.edition_id join works w on w.id=e.work_id
  where eb.match_state='linked' and w.kind='book'
    ${ids ? sql`and eb.id in (select value::uuid from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))` : sql``}
  order by w.title, eb.id`);
const proposal = (row: LegacyRow, dayStartHour: number) => proposeEbookReading({ progressPercent: row.fraction,
  startedAt: row.startedAt ? new Date(row.startedAt) : null, lastReadAt: row.lastReadAt ? new Date(row.lastReadAt) : null,
  finishedAt: row.finishedAt ? new Date(row.finishedAt) : null }, { ...row, now: new Date(), timeZone: appTimeZone(), dayStartHour });

/** Preview does not create imports or write inferred dates into the recovery table. */
export async function previewReaderHistory() {
  const [settings, result] = await Promise.all([readReaderSettings(), legacyRows()]);
  return resultRows<LegacyRow>(result).map((row) => ({ ebookId: row.ebookId, title: row.title, fingerprint: row.fingerprint,
    imported: row.imported, ...proposal(row, settings.readingDayStartHour) }));
}

const operationId = z.uuid().transform((id) => id.toLowerCase());
const date = z.iso.date().nullable();
const selection = z.strictObject({ ebookId: z.uuid(), fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
  status: z.enum(["reading", "paused", "finished"]), startedOn: date, finishedOn: date, percent: z.number().min(0).max(100) });
const commitSchema = z.strictObject({ operationId, rows: z.array(selection).min(1).max(100) });

/** Explicit user commit creates the operation; the preview above is strictly read-only. */
export async function beginReaderHistory(input: { operationId: string; total: number }) {
  const value = z.strictObject({ operationId, total: z.number().int().min(1).max(100_000) }).parse(input);
  await atomic((d) => [
    d.insert(imports).values({ id: value.operationId, source: "reader", status: "pending", totalRecords: value.total,
      startedAt: new Date(), errorLog: { kind: "reader-backfill-v1", entries: [] } }).onConflictDoNothing({ target: imports.id }),
    d.execute(assertSql(sql`exists(select 1 from imports where id=${value.operationId}::uuid and source='reader'
      and error_log->>'kind'='reader-backfill-v1' and status in ('pending','completed') and total_records=${value.total})`, "This recovery operation is no longer available")),
  ]);
  const [operation] = await db.select({ status: imports.status }).from(imports).where(eq(imports.id, value.operationId));
  return { operationId: value.operationId, status: operation.status };
}

/** Each batch re-reads catalogue ownership and writes at most 100 through the shared writer. */
export async function commitReaderHistory(input: z.input<typeof commitSchema>) {
  const value = commitSchema.parse(input);
  if (new Set(value.rows.map((row) => row.ebookId)).size !== value.rows.length) throw new Error("Choose each eBook once");
  return withReaderWriteRetry(async () => {
    const [settings, result] = await Promise.all([readReaderSettings(), legacyRows(value.rows.map((row) => row.ebookId))]);
    const current = new Map(resultRows<LegacyRow>(result).map((row) => [row.ebookId, row]));
    const rows = value.rows.map((choice) => {
      const row = current.get(choice.ebookId);
      if (!row || row.fingerprint !== choice.fingerprint) throw new Error("Reader history changed. Refresh the preview before importing.");
      const base = proposal(row, settings.readingDayStartHour).reading;
      return { ...base, status: choice.status, startedOn: choice.startedOn, startedPrecision: choice.startedOn ? "day" as const : "unknown" as const,
        finishedOn: choice.status === "finished" ? choice.finishedOn : null,
        finishedPrecision: choice.status === "finished" && choice.finishedOn ? "day" as const : "unknown" as const,
        position: { percent: choice.percent }, sourceKey: readerReadingKey(row.ebookId) };
    });
    const outcomes = await writeReadings(rows, { source: "backfill", importId: value.operationId,
      beforeChunk: (d, chunk) => {
        const bindings = chunk.map(({ row }) => {
          const choice = value.rows.find((item) => readerReadingKey(item.ebookId) === row.sourceKey)!;
          return { ebookId: choice.ebookId, fingerprint: choice.fingerprint, instanceId: row.instanceId, editionId: row.editionId, workId: row.workId };
        });
        return [
          lockReaderEbooks(d, sql`select (value->>'ebookId')::uuid from jsonb_array_elements(${JSON.stringify(bindings)}::jsonb)`),
          d.execute(sql`select id from imports where id=${value.operationId}::uuid for update`),
          d.execute(assertSql(sql`exists(select 1 from imports where id=${value.operationId}::uuid and source='reader'
            and status='pending' and error_log->>'kind'='reader-backfill-v1')`, "This recovery operation is no longer pending")),
          d.execute(assertSql(sql`not exists(select 1 from jsonb_array_elements(${JSON.stringify(bindings)}::jsonb) p
            where not exists(select 1 from legacy_reader_progress l join ebooks eb on eb.id=l.ebook_id
              join instances i on i.id=eb.instance_id join editions e on e.id=i.edition_id
              where eb.id=(p->>'ebookId')::uuid and eb.match_state='linked' and i.id=(p->>'instanceId')::uuid
                and e.id=(p->>'editionId')::uuid and e.work_id=(p->>'workId')::uuid
                and md5(to_jsonb(l)::text || i.id::text || e.id::text || e.work_id::text || coalesce(e.page_count::text,''))=p->>'fingerprint'))`,
          "Reader history changed. Refresh the preview before importing.")),
          d.execute(sql`select set_config('durtal.reader_backfill_queue',coalesce((select jsonb_agg(to_jsonb(q))::text
            from reading_queue q where q.work_id in (select (value->>'workId')::uuid from jsonb_array_elements(${JSON.stringify(bindings)}::jsonb))),'[]'),true)`),
        ];
      },
      afterChunk: (d, chunk) => [d.execute(sql`update imports set error_log=jsonb_set(error_log,'{entries}',
        coalesce(error_log->'entries','[]'::jsonb) || coalesce((select jsonb_agg(jsonb_build_object(
          'id',r.id,'workId',r.work_id,'fingerprint',md5(to_jsonb(r)::text),'queue',
          (select q from jsonb_array_elements(current_setting('durtal.reader_backfill_queue')::jsonb) q where (q->>'work_id')::uuid=r.work_id)))
          from readings r where r.id in (select value::uuid from jsonb_array_elements_text(${JSON.stringify(chunk.map((item) => item.id))}::jsonb))
            and r.import_id=${value.operationId}::uuid and r.source='backfill'),'[]'::jsonb))
        where id=${value.operationId}::uuid`)],
    });
    invalidate(CACHE_TAGS.reading, CACHE_TAGS.works);
    return outcomes;
  });
}

export async function finishReaderHistory(id: string) {
  const value = operationId.parse(id);
  await db.update(imports).set({ status: "completed", completedAt: new Date(),
    processedRecords: sql`jsonb_array_length(coalesce(error_log->'entries','[]'::jsonb))` })
    .where(sql`${imports.id}=${value}::uuid and ${imports.source}='reader' and ${imports.status}='pending'`);
}

/** An edited/imported/foreign reading is never an Undo target, even under an old operation ID. */
export async function undoReaderHistory(id: string) {
  const value = operationId.parse(id);
  const result = await withReaderWriteRetry(() => atomic((d) => [
    lockReaderBindings(d, sql`select eb.id from ebooks eb join instances i on i.id=eb.instance_id join editions e on e.id=i.edition_id
      where e.work_id in (select work_id from readings where import_id=${value}::uuid and source='backfill')`,
      sql`select n.id from reading_notes n join readings r on r.id=n.reading_id where r.import_id=${value}::uuid and r.source='backfill'`),
    lockReaderNotes(d, sql`select n.id from reading_notes n join readings r on r.id=n.reading_id where r.import_id=${value}::uuid and r.source='backfill'`),
    d.execute(sql`select id from imports where id=${value}::uuid for update`),
    d.execute(assertSql(sql`exists(select 1 from imports where id=${value}::uuid and source='reader'
      and error_log->>'kind'='reader-backfill-v1' and status in ('pending','completed','undone'))`, "This is not a reader recovery operation")),
    d.execute(sql`with journal as materialized (
      select e from imports i cross join lateral jsonb_array_elements(i.error_log->'entries') e where i.id=${value}::uuid
    ), locked as materialized (
      select r.id from readings r join journal j on r.id=(j.e->>'id')::uuid
      where r.import_id=${value}::uuid and r.source='backfill' and md5(to_jsonb(r)::text)=j.e->>'fingerprint' for update of r
    ), removed as (
      delete from readings r using locked l where r.id=l.id returning r.id,r.work_id
    ), restored as (
      insert into reading_queue(id,work_id,edition_id,position,note,source,import_id,source_key,added_at)
      select (q->>'id')::uuid,(q->>'work_id')::uuid,
        case when exists(select 1 from editions where id=(q->>'edition_id')::uuid) then (q->>'edition_id')::uuid else null end,
        (q->>'position')::integer,q->>'note',q->>'source',
        case when exists(select 1 from imports where id=(q->>'import_id')::uuid) then (q->>'import_id')::uuid else null end,
        q->>'source_key',(q->>'added_at')::timestamptz
      from journal j join removed r on r.id=(j.e->>'id')::uuid cross join lateral (select j.e->'queue' as q) saved
      where q is not null and q<>'null'::jsonb
        and not exists(select 1 from readings other where other.work_id=r.work_id and other.id<>r.id and other.status in ('reading','paused'))
      on conflict do nothing returning id
    ) select count(*)::integer as removed from removed`),
    d.update(imports).set({ status: "undone" }).where(eq(imports.id, value)),
  ]));
  invalidate(CACHE_TAGS.reading, CACHE_TAGS.works);
  return resultRows<{ removed: number }>(result[4])[0]?.removed ?? 0;
}

export async function readerHistoryOperations() {
  return db.select({ id: imports.id, status: imports.status, createdAt: imports.createdAt, processedRecords: imports.processedRecords })
    .from(imports).where(sql`${imports.source}='reader' and ${imports.errorLog}->>'kind'='reader-backfill-v1'`)
    .orderBy(sql`${imports.createdAt} desc`).limit(50);
}
