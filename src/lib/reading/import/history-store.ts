import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { assertSql, resultRows } from "@/lib/harmonization/store";
import { CACHE_TAGS, invalidate } from "@/lib/cache";
import { resolutionQuery, restoreInput } from "./history-match";
import type { ImportRow } from "./types";
import type { StoredRow, CommitResult } from "./store";

export interface RestoreJournal {
  entity: "readings" | "sessions" | "notes";
  id: string;
  created: boolean;
  snapshot: Record<string, unknown>;
  workId: string;
  outcome: "written" | "already_present";
}
export interface ParentJournal {
  oldReadingId: string | null; oldWorkId: string | null;
  readingId: string; workId: string; sourceKey: string | null;
  proof: "inserted" | "Same reading" | "Same source";
}
const TABLES = { readings:"readings", sessions:"reading_sessions", notes:"reading_notes" } as const;
const COLUMNS = {
  readings: "id work_id edition_id instance_id location_id format status started_on started_precision finished_on finished_precision unit total_pages total_minutes start_page start_percent start_minutes current_page current_percent current_minutes current_chapter last_read_at rating review_html review_json abandon_reason abandon_note source import_id source_key created_at updated_at".split(" "),
  sessions: "id reading_id edition_id format read_on time_zone started_at ended_at duration_seconds start_page end_page start_percent end_percent start_minutes end_minutes end_chapter pages_total note source paused_at paused_seconds created_at updated_at".split(" "),
  notes: "id work_id reading_id edition_id kind body comment_html comment_json page end_page page_roman chapter percent is_favourite source import_id source_key created_at updated_at".split(" "),
};
function payload(row: ImportRow, importId: string): Record<string,unknown> {
  const h=row.history;
  if (h) return {...h.values,id:h.id,source:h.source,edition_id:h.editionId,created_at:h.createdAt,updated_at:h.updatedAt,
    ...(h.entity === "notes" ? {import_id:importId,comment_json:h.values.comment_json ? JSON.parse(String(h.values.comment_json)) : null} : {paused_at:null})};
  const r=row.readings[0], b=r.restore!;
  return {id:randomUUID(),edition_id:row.editionId,instance_id:row.instanceId,location_id:b.locationId,format:r.format,status:r.status,
    started_on:r.startedOn,started_precision:r.startedPrecision,finished_on:r.finishedOn,finished_precision:r.finishedPrecision,
    unit:r.unit,total_pages:r.totalPages,total_minutes:r.totalMinutes,start_page:b.startPage,start_percent:b.startPercent,start_minutes:b.startMinutes,
    current_page:b.currentPage,current_percent:b.currentPercent,current_minutes:b.currentMinutes,current_chapter:b.currentChapter,
    last_read_at:b.lastReadAt,rating:r.rating,review_html:r.reviewHtml,review_json:null,abandon_reason:r.abandonReason,abandon_note:r.abandonNote,
    source:b.source,import_id:importId,source_key:r.sourceKey,created_at:b.createdAt,updated_at:b.updatedAt};
}

/** One bounded transaction: lock, re-resolve, insert, and save only INSERT RETURNING ownership.
 * Existing records never receive UPDATE, including their provenance and timestamps.
 */
function restoreStatement(importId: string, row: StoredRow) {
  const input=restoreInput(row.data,row.rowNo,row.match.chosen ? row.workId : null);
  const kind=input.kind, table=sql.raw(TABLES[kind]), columns=COLUMNS[kind];
  const values=payload(row.data,importId);
  const refs=columns.map((key)=> key === "work_id" ? sql`r."workId"::uuid` : key === "reading_id" ? sql`r."readingId"::uuid`
    : key === "created_at" ? sql`coalesce(p.created_at,now())` : key === "updated_at" ? sql`coalesce(p.updated_at,p.created_at,now())` : sql.raw(`p.${key}`));
  const sourceCollision = kind === "notes" ? sql`exists(select 1 from reading_notes n where n.source_key=p.source_key and n.id<>p.id)` : sql`false`;
  const locationInvalid = kind === "readings" ? sql`p.location_id is not null and not exists(select 1 from locations l where l.id=p.location_id)` : sql`false`;
  const opened = kind === "readings" ? sql`p.status in ('reading','paused') and exists(select 1 from readings x where x.work_id=r."workId"::uuid and x.status in ('reading','paused'))` : sql`false`;
  return sql`
    with current_row as materialized (
      select * from reading_import_rows where import_id=${importId}::uuid and row_no=${row.rowNo}
        and decision='import' and data=${JSON.stringify(row.data)}::jsonb
        and work_id is not distinct from ${row.workId}::uuid
        and coalesce(written->'history','null'::jsonb)='null'::jsonb for update
    ), resolved as (${resolutionQuery([input])}), p as (
      select * from jsonb_populate_record(null::${table},${JSON.stringify(values)}::jsonb)
    ), eligible as (
      select r.*, case when r.error is not null then r.error
        when r."workId"::uuid is distinct from ${row.workId}::uuid then 'The parent changed; match again before restoring'
        when ${sourceCollision} then 'The note source key belongs to another record'
        when ${locationInvalid} then 'The original location is missing'
        when r."existingId" is null and ${opened} then 'This book already has an open reading'
        else null end as refusal
      from resolved r cross join p
    ), inserted as (
      insert into ${table} (${sql.join(columns.map((c)=>sql.raw(c)),sql`, `)})
      select ${sql.join(refs,sql`, `)} from p cross join eligible r
      where exists(select 1 from current_row) and r.refusal is null and r."existingId" is null
      on conflict do nothing returning *
    ), status_history as (
      ${kind === "readings" ? sql`insert into reading_status_history (reading_id,from_status,to_status,changed_at,notes)
        select id,null,status,created_at,'Restored from Durtal' from inserted returning reading_id` : sql`select null::uuid as reading_id where false`}
    ), observed as (
      select i.id, to_jsonb(i) as snapshot, true as created from inserted i
      union all
      select old.id,to_jsonb(old),false from ${table} old cross join eligible r
        where r.refusal is null and old.id::text=r."existingId" and exists(select 1 from current_row)
    ), saved as (
      update reading_import_rows j set written=coalesce(j.written,'{"readings":[],"bookRating":null,"identifiers":[]}'::jsonb) ||
        jsonb_build_object('history',jsonb_build_object('entity',${kind}::text,'id',o.id,'created',o.created,
          'snapshot',o.snapshot,'workId',r."workId",'outcome',case when o.created then 'written' else 'already_present' end)) ||
        case when ${kind}='readings' then jsonb_build_object('parent',jsonb_build_object(
          'oldReadingId',${input.oldReading}::text,'oldWorkId',${input.oldWork}::text,'readingId',o.id,
          'workId',r."workId",'sourceKey',o.snapshot->>'source_key',
          'proof',case when o.created then 'inserted' when o.id::text=${input.oldReading}::text then 'Same reading' else 'Same source' end)) else '{}'::jsonb end
      from observed o cross join eligible r where j.import_id=${importId}::uuid and j.row_no=${row.rowNo}
        and exists(select 1 from current_row)
      returning j.written->'history'->>'outcome' as outcome
    )
    select outcome,null::text as reason from saved
    union all
    select 'refused',coalesce(r.refusal,'The record changed during restore; match again') from eligible r
      where exists(select 1 from current_row) and not exists(select 1 from saved)`;
}
const locks = (d: typeof db) => [
  d.execute(sql`select set_config('TimeZone','UTC',true)`),
  // Stable order shared by restore/undo. A following statement gets a fresh
  // READ COMMITTED snapshot after any previous writer finishes.
  d.execute(sql`lock table works, editions, instances, locations in share mode`),
  d.execute(sql`lock table readings, reading_sessions, reading_notes in share row exclusive mode`),
];

export async function commitRestores(importId:string, rows:StoredRow[], epoch:string):Promise<CommitResult> {
  const result:CommitResult={identifiers:0,written:0,present:0,refused:0,rows:0,queued:0,queuePresent:0,queueSkipped:0,notes:0,notesPresent:0,sessions:0,sessionsPresent:0};
  const unchanged=sql`exists(select 1 from imports where id=${importId}::uuid
    and source='durtal' and error_log->>'restoreEpoch'=${epoch})`;
  const errors:{rowNo:number;reason:string}[]=[];
  const todo=rows.filter((r)=>r.decision==='import'&&!r.data.error&&!r.written?.history);
  for(let at=0;at<todo.length;at+=50) {
    const chunk=todo.slice(at,at+50);
    const results=await withReadableErrors(()=>atomic((d)=>[
      d.execute(sql`select id from imports where id=${importId}::uuid for update`),
      d.execute(assertSql(unchanged,"This import changed through Undo; start the import again")),...locks(d),
      ...chunk.map((row)=>d.execute(restoreStatement(importId,row))),
    ]));
    chunk.forEach((row,i)=>{
      for(const out of resultRows<{outcome:string;reason:string|null}>(results[i+5])) {
        result.rows++;
        if(out.outcome==='refused') {result.refused++;errors.push({rowNo:row.rowNo,reason:(out.reason??'Not restored').slice(0,200)});}
        else if(row.data.kind==='sessions') {if(out.outcome==='written') result.sessions!++;else result.sessionsPresent!++;}
        else if(row.data.kind==='notes') {if(out.outcome==='written') result.notes++;else result.notesPresent++;}
        else if(out.outcome==='written') result.written++;else result.present++;
      }
    });
  }
  await withReadableErrors(()=>atomic((d)=>[
    d.execute(sql`select id from imports where id=${importId}::uuid for update`),
    d.execute(assertSql(unchanged,"This import changed through Undo; start the import again")),
    d.execute(sql`update imports i set status='completed', completed_at=now(),
    processed_records=(select count(*) from reading_import_rows j where j.import_id=i.id and j.written->'history' is not null),
    skipped_records=(select count(*) from reading_import_rows j where j.import_id=i.id and j.decision<>'import'),
    error_records=${errors.length}, error_log=coalesce(i.error_log,'{}'::jsonb) || jsonb_build_object('missing',coalesce(i.error_log->'missing','[]'::jsonb),'errors',${JSON.stringify(errors)}::jsonb)
    where i.id=${importId}::uuid and ${unchanged}`),
  ]));
  invalidate(CACHE_TAGS.works,CACHE_TAGS.reading);
  return result;
}

/** Full row equality plus effective parent ownership. Undo and the journal update
 * share the same transaction; a lost response cannot make a later undo own more.
 */
export async function undoRestores(importId:string) {
  const result={removed:0,kept:0,queueRemoved:0,queueKept:0,notesRemoved:0,notesKept:0,identifiersKept:0,sessionsRemoved:0,sessionsKept:0};
  const output=await atomic((d)=>[
    d.execute(sql`select id from imports where id=${importId}::uuid for update`),...locks(d),
    ...(["notes","sessions","readings"] as const).map((kind)=>{
      const table=sql.raw(TABLES[kind]);
      const owner = kind==='sessions' ? sql`exists(select 1 from readings p where p.id=t.reading_id and p.work_id::text=j.written->'history'->>'workId')`
        : sql`t.work_id::text=j.written->'history'->>'workId'`;
      const editionOwner = sql`and (t.edition_id is null or exists(select 1 from editions e where e.id=t.edition_id and e.work_id::text=j.written->'history'->>'workId'))`;
      const linkedOwner = kind === 'notes' ? sql`and (t.reading_id is null or exists(select 1 from readings p where p.id=t.reading_id and p.work_id::text=j.written->'history'->>'workId'))` : sql``;
      const dependencies = kind==='readings'  ? sql`and not exists(select 1 from reading_sessions s where s.reading_id=t.id)
        and not exists(select 1 from reading_notes n where n.reading_id=t.id)
        and (select count(*) from reading_status_history h where h.reading_id=t.id)=1
        and exists(select 1 from reading_status_history h where h.reading_id=t.id and h.from_status is null
          and h.to_status=t.status and h.changed_at=t.created_at and h.notes='Restored from Durtal')` : sql``;
      return d.execute(sql`with removed as (
        delete from ${table} t using reading_import_rows j
        where j.import_id=${importId}::uuid and j.written->'history'->>'entity'=${kind}
          and j.written->'history'->>'created'='true' and t.id::text=j.written->'history'->>'id'
          and to_jsonb(t)=j.written->'history'->'snapshot' and ${owner} ${editionOwner} ${linkedOwner} ${dependencies}
          returning t.id
      ), cleared as (
        update reading_import_rows j set written=nullif(nullif(j.written-'history'-'parent',
          '{"readings":[],"bookRating":null,"identifiers":[]}'::jsonb),'{}'::jsonb)
        where j.import_id=${importId}::uuid and j.written->'history'->>'entity'=${kind}
          and (j.written->'history'->>'created'='false' or j.written->'history'->>'id' in(select id::text from removed)
            or not exists(select 1 from ${table} t where t.id::text=j.written->'history'->>'id'))
        returning j.row_no
      ) select (select count(*)::int from removed) as removed,
        (select count(*)::int from reading_import_rows j join ${table} t on t.id::text=j.written->'history'->>'id'
          where j.import_id=${importId}::uuid and j.written->'history'->>'entity'=${kind}
            and j.written->'history'->>'created'='true' and not exists(select 1 from removed x where x.id=t.id)) as kept`);
    }),
    d.execute(sql`update imports set status='undone',processed_records=0, error_log=coalesce(error_log,'{}'::jsonb) || jsonb_build_object('restoreEpoch',${randomUUID()}::text) where id=${importId}::uuid`),
  ]);
  (["notes","sessions","readings"] as const).forEach((kind,i)=>{
    const count=resultRows<{removed:number;kept:number}>(output[i+4])[0];
    if(kind==='notes'){result.notesRemoved=count.removed;result.notesKept=count.kept;}
    else if(kind==='sessions'){result.sessionsRemoved=count.removed;result.sessionsKept=count.kept;}
    else {result.removed=count.removed;result.kept=count.kept;}
  });
  invalidate(CACHE_TAGS.works,CACHE_TAGS.reading);
  return result;
}
