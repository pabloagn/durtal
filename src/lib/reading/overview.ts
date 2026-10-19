import { sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { ExpectedActionError } from "@/lib/actions/expected-error";
import { readingOrdinalSql } from "./summary";
import { cleanReview, type Reading } from "./service";
import { BOOK_HISTORY_LIMIT, READING_CHOICE_PAGE_SIZE, type BookReadingSummary, type ReadingStartDefaults, type ReadingChoicePage, type ReadingChoice } from "./overview-types";

/** A complete mutation row, enriched only after the bounded IDs are chosen. */
export interface ReadingDetailRow {
  reading: Reading;
  fingerprint: string;
  ordinal: number;
  sessionCount: number;
  totalSeconds: number;
  quoteCount: number;
  noteCount: number;
  ownEditionQuoteCount: number;
  ownEditionNoteCount: number;
  edition: { id: string; title: string; coverS3Key: string | null; thumbnailS3Key: string | null; pageCount: number | null; language: string | null; translators: string[] } | null;
  copy: { id: string; location: string | null; shelf: string | null } | null;
  home: { id: string; name: string } | null;
  previousClosed: { editionId: string | null } | null;
}
export interface BookReadingOverview { rows: ReadingDetailRow[]; summary: BookReadingSummary; defaults: ReadingStartDefaults; history: { closedCount: number; hasMore: boolean } }

// Match readingRecord: a non-null date with unknown precision is not known.
const knownFirstDate = sql`case when started_on is not null and started_precision <> 'unknown' then started_on when finished_on is not null and finished_precision <> 'unknown' then finished_on end`;
const knownFirstPrecision = sql`case when started_on is not null and started_precision <> 'unknown' then started_precision else finished_precision end`;

const historyOrder = (alias: string) => sql.raw(`(${alias}.status in ('reading','paused')) desc, coalesce(${alias}.finished_on, ${alias}.started_on) desc nulls last, ${alias}.created_at desc, ${alias}.id desc`);

// r is the original table row, not the window projection: its fingerprint
// must keep exactly the shape used by every reading mutation.
const detail = sql`jsonb_build_object(
  'reading', to_jsonb(r), 'fingerprint', md5(to_jsonb(r)::text), 'ordinal', f.ordinal,
  'sessionCount', (select count(*)::int from reading_sessions s where s.reading_id=r.id and not (s.source='timer' and s.ended_at is null)),
  'totalSeconds', (select coalesce(sum(s.duration_seconds),0)::int from reading_sessions s where s.reading_id=r.id),
  'quoteCount', (select count(*)::int from reading_notes n where n.reading_id=r.id and n.kind='quote'),
  'noteCount', (select count(*)::int from reading_notes n where n.reading_id=r.id and n.kind='note'),
  'ownEditionQuoteCount', (select count(*)::int from reading_notes n where n.reading_id=r.id and n.kind='quote' and n.edition_id is not distinct from r.edition_id),
  'ownEditionNoteCount', (select count(*)::int from reading_notes n where n.reading_id=r.id and n.kind='note' and n.edition_id is not distinct from r.edition_id),
  'edition', (select jsonb_build_object('id',e.id,'title',e.title,'coverS3Key',e.cover_s3_key,'thumbnailS3Key',e.thumbnail_s3_key,'pageCount',e.page_count,'language',e.language,
    'translators',coalesce((select jsonb_agg(a.name order by ec.sort_order) from edition_contributors ec join authors a on a.id=ec.author_id where ec.edition_id=e.id and ec.role='translator'),'[]'::jsonb)) from editions e where e.id=r.edition_id),
  'copy', (select jsonb_build_object('id',i.id,'location',l.name,'shelf',sl.name) from instances i left join locations l on l.id=i.location_id left join sub_locations sl on sl.id=i.sub_location_id where i.id=r.instance_id),
  'home', (select jsonb_build_object('id',l.id,'name',l.name) from locations l where l.id=r.location_id),
  'previousClosed', case when r.status not in ('reading','paused') and f.previous_id is not null then jsonb_build_object('editionId',f.previous_edition_id) end
)`;

function camelReading(raw: Record<string, unknown>): Reading {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) row[key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  for (const key of ["lastReadAt", "createdAt", "updatedAt"]) if (row[key]) row[key] = new Date(row[key] as string);
  return cleanReview(row as Reading);
}

/** One SQL request: all-history facts, but at most open + four closed + one explicitly requested row are enriched/sent. */
export async function queryBookReadingOverview(workId: string, targetReadingId: string | null = null): Promise<BookReadingOverview> {
  const id = z.uuid().parse(workId);
  const target = targetReadingId === null ? null : z.uuid().parse(targetReadingId);
  const [result] = resultRows<{ rows: ReadingDetailRow[]; summary: BookReadingSummary; defaults: ReadingStartDefaults }>(await db.execute(sql`
    with facts as materialized (
      select r.*, ${readingOrdinalSql("r")} as ordinal,
        row_number() over (partition by (r.status in ('reading','paused')) order by ${historyOrder("r")}) as display_rank,
        lead(r.id) over (partition by (r.status in ('reading','paused')) order by ${historyOrder("r")}) as previous_id,
        lead(r.edition_id) over (partition by (r.status in ('reading','paused')) order by ${historyOrder("r")}) as previous_edition_id
      from readings r where r.work_id=${id}::uuid
    ), counts as (
      select count(*)::int as total, count(*) filter (where status in ('reading','paused'))::int as open,
        count(*) filter (where status='finished')::int as finished, count(*) filter (where status='abandoned')::int as abandoned from facts
    ), rated as (
      select f.ordinal, f.finished_on, coalesce(f.rating::float8, case when c.finished=1 then w.rating::float8 end) as rating
      from facts f cross join counts c join works w on w.id=${id}::uuid where f.status='finished'
    ), sessions as (
      select count(*) filter (where not(s.source='timer' and s.ended_at is null))::int as count,
        coalesce(sum(s.duration_seconds),0)::bigint as seconds from reading_sessions s join facts f on f.id=s.reading_id
    )
    select
      coalesce((select jsonb_agg(${detail} order by ${historyOrder("r")}) from readings r join facts f on f.id=r.id
        where r.status in ('reading','paused') or f.display_rank<=${BOOK_HISTORY_LIMIT} or r.id=${target}::uuid),'[]'::jsonb) as rows,
      (select jsonb_build_object(
        'readingCount',c.total,'openCount',c.open,'finishedCount',c.finished,'abandonedCount',c.abandoned,'sessionCount',s.count,
        'openReadingId',(select id from facts where status in ('reading','paused') limit 1),
        'state',coalesce((select status from facts where status in ('reading','paused') limit 1),
          case (select status from facts where status not in ('reading','paused') order by ${historyOrder("facts")} limit 1) when 'abandoned' then 'abandoned' when 'finished' then 'read' else 'unread' end),
        'latestClosedId',(select id from facts where status not in ('reading','paused') order by ${historyOrder("facts")} limit 1),
        'latestClosedStatus',(select status from facts where status not in ('reading','paused') order by ${historyOrder("facts")} limit 1),
        'latestFinished',(select jsonb_build_object('date',finished_on::text,'precision',finished_precision) from facts where status='finished' and finished_on is not null order by finished_on desc nulls last,created_at desc,id desc limit 1),
        'record',jsonb_build_object(
          'firstKnown',(select jsonb_build_object('date',(${knownFirstDate})::text,'precision',${knownFirstPrecision})
            from facts where (${knownFirstDate}) is not null order by ${knownFirstDate},${historyOrder("facts")} limit 1),
          'lastKnownFinished',(select jsonb_build_object('date',finished_on::text,'precision',finished_precision) from facts where status='finished' and finished_on is not null and finished_precision<>'unknown' order by finished_on desc,created_at desc,id desc limit 1),
          'durationSeconds',s.seconds),
        'ratings',jsonb_build_object('count',(select count(*) from rated where rating is not null),
          'preview',coalesce((select jsonb_agg(jsonb_build_object('rating',rating,'ordinal',ordinal,'year',substring(finished_on::text,1,4)) order by ordinal) from (select * from rated where rating is not null order by ordinal desc limit ${BOOK_HISTORY_LIMIT}) p),'[]'::jsonb),
          'hasMore',(select count(*) from rated where rating is not null)>${BOOK_HISTORY_LIMIT})
      ) from counts c cross join sessions s) as summary,
      jsonb_build_object(
        'lastEditionId',(select edition_id from facts where edition_id is not null order by ${historyOrder("facts")} limit 1),
        'latestMinutesByEdition',coalesce((select jsonb_object_agg(edition_id,total_minutes) from (
          select distinct on (edition_id) edition_id,total_minutes from facts where edition_id is not null and total_minutes is not null and total_minutes<>0
          order by edition_id,${historyOrder("facts")}) lengths),'{}'::jsonb)
      ) as defaults
  `));
  if (!result) throw new ExpectedActionError("Could not load reading history");
  if (result.summary.openCount > 1) throw new ExpectedActionError("This book has more than one open reading; its history needs checking");
  const rows = result.rows.map(row => ({ ...row, reading: camelReading(row.reading as unknown as Record<string, unknown>) }));
  if (target && !rows.some(row => row.reading.id === target)) throw new ExpectedActionError("This reading no longer exists in this book");
  const closedCount = result.summary.readingCount - result.summary.openCount;
  return { ...result, rows, history: { closedCount, hasMore: closedCount > BOOK_HISTORY_LIMIT } };
}

const choiceColumns = sql`r.id,r.ordinal,r.status,r.edition_id as "editionId",e.title as "editionLabel",r.unit,
  r.current_page as "currentPage",r.current_percent::float8 as "currentPercent",r.current_chapter as "currentChapter",
  r.started_on::text as "startedOn",r.started_precision as "startedPrecision",r.finished_on::text as "finishedOn",r.finished_precision as "finishedPrecision"`;
const rankedChoices = (id: string) => sql`select r.*,${readingOrdinalSql("r")} as ordinal from readings r where r.work_id=${id}::uuid`;

/** Choices are slim and paged; ranking precedes search and the page boundary. */
export async function queryReadingChoices(workId: string, page = 1, query = ""): Promise<ReadingChoicePage> {
  const id = z.uuid().parse(workId);
  const p = z.number().int().min(1).max(1_000_000).parse(page);
  const q = z.string().max(200).parse(query).trim();
  const condition: SQL = q ? sql`strpos(lower(concat_ws(' ',r.ordinal::text,r.started_on::text,r.finished_on::text,r.status,e.title)),lower(${q})) > 0` : sql`true`;
  const [found] = resultRows<{ items: ReadingChoice[]; total: number }>(await db.execute(sql`
    with ranked as (${rankedChoices(id)}), filtered as (
      select ${choiceColumns},r.finished_on,r.started_on,r.created_at from ranked r left join editions e on e.id=r.edition_id where ${condition}
    ) select (select count(*)::int from filtered) as total,
      coalesce((select jsonb_agg(to_jsonb(p)-'finished_on'-'started_on'-'created_at'-'slot' order by p.slot) from (
        select *,row_number() over(order by ${historyOrder("filtered")}) as slot from filtered order by ${historyOrder("filtered")}
        limit ${READING_CHOICE_PAGE_SIZE} offset ${(p-1)*READING_CHOICE_PAGE_SIZE}) p),'[]'::jsonb) as items
  `));
  return { items: found?.items ?? [], total: found?.total ?? 0, page: p, hasNext: p*READING_CHOICE_PAGE_SIZE < (found?.total ?? 0) };
}

export async function queryReadingChoice(workId: string, readingId: string): Promise<ReadingChoice | null> {
  const id = z.uuid().parse(workId), selected = z.uuid().parse(readingId);
  const [row] = resultRows<ReadingChoice>(await db.execute(sql`with ranked as (${rankedChoices(id)}) select ${choiceColumns} from ranked r left join editions e on e.id=r.edition_id where r.id=${selected}::uuid`));
  return row ?? null;
}
