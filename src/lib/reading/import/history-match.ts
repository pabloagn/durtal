import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import type { ImportRow } from "./types";
import type { ImportMatch } from "./match-rules";

export interface RestoreInput {
  rowNo: number; status: string | null; kind: "readings" | "sessions" | "notes"; id: string | null;
  oldWork: string | null; oldReading: string | null; sourceKey: string | null;
  edition: string | null; instance: string | null; chosenWork: string | null;
}
export interface RestoreResolution {
  rowNo: number; workId: string | null; readingId: string | null;
  existingId: string | null; error: string | null;
}
export function restoreInput(row: ImportRow, rowNo: number, chosenWork: string | null = null): RestoreInput {
  const r = row.readings[0], h = row.history;
  return { rowNo, status:r?.status ?? null, kind: h?.entity ?? "readings", id: h?.id ?? r?.readingId ?? null,
    oldWork: h?.workId ?? row.workId, oldReading: h?.readingId ?? r?.readingId ?? null,
    sourceKey: h?.readingSourceKey ?? r?.sourceKey ?? null, edition: h?.editionId ?? row.editionId,
    instance: row.instanceId, chosenWork };
}

/** Shared by preview and the writer, where table locks are already held.
 * An existing explicit UUID always wins, including its wrong-parent conflict.
 * Missing UUIDs can only follow exact keys or a durable, still-valid parent journal.
 */
export function resolutionQuery(inputs: RestoreInput[]) {
  return sql`
    with input as (
      select * from jsonb_to_recordset(${JSON.stringify(inputs)}::jsonb) as i(
        "rowNo" int, status text, kind text, id uuid, "oldWork" uuid, "oldReading" uuid, "sourceKey" text,
        edition uuid, instance uuid, "chosenWork" uuid)
    ), candidates as (
      select i.*, direct.id as direct_id, direct.work_id as direct_work,
        picked.id as picked_id, picked.work_id as picked_work, picked.n as picked_count,
        coalesce(direct.id,picked.id) as parent_id,
        coalesce(direct.work_id,picked.work_id,i."chosenWork",i."oldWork") as work_id
      from input i
      left join readings direct on direct.id=i."oldReading"
      left join lateral (
        select (array_agg(c.id order by c.id))[1] as id, (array_agg(c.work_id order by c.id))[1] as work_id, count(distinct c.id)::int as n
        from (
          select c.*, min(priority) over () as best from (
            select r.id,r.work_id,1 as priority from readings r where i."sourceKey" is not null and r.source_key=i."sourceKey"
            union all
            select r.id,r.work_id,2 from readings r where i."oldReading" is not null and r.source_key='durtal:'||i."oldReading"::text
            union all
            select r.id,r.work_id,3 from reading_import_rows j
              join readings r on r.id::text=j.written->'parent'->>'readingId'
                and r.work_id::text=j.written->'parent'->>'workId'
                and r.source_key is not distinct from j.written->'parent'->>'sourceKey'
              where i."oldReading" is not null and j.written->'parent'->>'oldReadingId'=i."oldReading"::text
                and (i."oldWork" is null or j.written->'parent'->>'oldWorkId'=i."oldWork"::text)
                and j.written->'parent'->>'proof' in ('inserted','Same reading','Same source')
          ) c
        ) c where c.priority=c.best
      ) picked on direct.id is null
    )
    select c."rowNo", w.id::text as "workId", c.parent_id::text as "readingId",
      case when c.kind='readings' then c.parent_id::text else existing.id::text end as "existingId",
      case
        when c.direct_id is not null and c."oldWork" is not null and c.direct_work<>c."oldWork" then 'The reading UUID belongs to another book'
        when c.direct_id is null and c.picked_count>1 then 'Ambiguous reading parent mapping'
        when c.parent_id is not null and c."oldWork" is not null and c.work_id<>c."oldWork"
          and exists(select 1 from works original where original.id=c."oldWork") then 'The reading source belongs to another book'
        when c.parent_id is not null and c."chosenWork" is not null and c.work_id<>c."chosenWork" then 'The reading belongs to another chosen book'
        when c.parent_id is null and c."chosenWork" is not null and c."oldWork" is not null and c."chosenWork"<>c."oldWork"
          and exists(select 1 from works original where original.id=c."oldWork") then 'The explicit book cannot be replaced by another book'
        when w.id is null then 'The parent book is missing or is not a book'
        when c.kind='readings' and c.parent_id is null and c.status in ('reading','paused')
          and exists(select 1 from readings opened where opened.work_id=w.id and opened.status in ('reading','paused')) then 'This book already has an open reading'
        when c.kind='sessions' and c.parent_id is null then 'Restore the parent reading first'
        when c.kind='notes' and (c."oldReading" is not null or c."sourceKey" is not null) and c.parent_id is null then 'Restore the parent reading first'
        when c.edition is not null and not exists(select 1 from editions e where e.id=c.edition and e.work_id=w.id) then 'The explicit edition is missing or belongs to another book'
        when c.instance is not null and not exists(select 1 from instances x where x.id=c.instance and x.edition_id=c.edition) then 'The explicit copy is missing or belongs to another edition'
        when existing.id is not null and (existing.work_id<>w.id or existing.reading_id is distinct from c.parent_id) then 'The record UUID belongs to another parent'
        else null
      end as error
    from candidates c left join works w on w.id=c.work_id and w.kind='book'
    left join lateral (
      select s.id,r.work_id,s.reading_id from reading_sessions s join readings r on r.id=s.reading_id where c.kind='sessions' and s.id=c.id
      union all
      select n.id,n.work_id,n.reading_id from reading_notes n where c.kind='notes' and n.id=c.id
    ) existing on true`;
}

export async function resolveRestores(inputs: RestoreInput[]): Promise<RestoreResolution[]> {
  const out: RestoreResolution[]=[];
  for(let at=0;at<inputs.length;at+=200) out.push(...resultRows<RestoreResolution>(await db.execute(resolutionQuery(inputs.slice(at,at+200)))));
  return out;
}
export function restoreMatch(row: ImportRow, resolution: RestoreResolution): ImportMatch {
  const missingBook=!row.history && !resolution.readingId && resolution.error === "The parent book is missing or is not a book";
  const error=row.error ?? (missingBook ? null : resolution.error);
  const exists=!!resolution.existingId;
  const reason=error ?? (exists ? "Already in Durtal; existing edits kept" : "Exact Durtal parent");
  return { found:resolution.workId?"exact":"none",reason,chosen:false,editionId:row.editionId,instanceId:row.instanceId,candidates:[],warnings:[],
    verdicts:[{n:1,verdict:error?"refused":exists?"already_present":"new",reason,readingId:resolution.readingId}],
    section:error?"cannot":missingBook?"none":exists?"present":"exact",note:reason };
}
