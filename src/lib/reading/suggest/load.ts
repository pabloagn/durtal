import { sql, type SQL } from "drizzle-orm";
import { ownedBookCondition } from "@/lib/catalogue/holdings";
import { WORK_AUTHOR_ROLES } from "@/lib/types";
import { languageName } from "@/lib/utils/language";
import { atHandCopySql, isAtHand } from "../at-hand";
import { tasteRatingSql } from "../summary";
import type { QueueEdition } from "../queue";
import type { SuggestBook, SuggestFeedback, SuggestHome, SuggestTerm } from "./types";

/*
 * The suggestion engine's one book query (SLN-457), run by any executor:
 * the app's database, or the evaluation script's read-only connection
 * (scripts/qa/suggestions-eval.ts).
 */

/** Runs a query and returns its rows: drizzle's execute on neon-http or postgres-js */
export type Execute = (query: SQL) => Promise<unknown>;

export function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];
}

/** "19th century" */
export function centuryName(century: number): string {
  const tens = century % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[century % 10] ?? "th");
  return `${century}${suffix} century`;
}

/** A book's writers: its authors and co-authors, as everywhere else in the app */
const WRITER = sql.raw(`wa.role in (${WORK_AUTHOR_ROLES.map((r) => `'${r}'`).join(", ")})`);

export interface Row extends Omit<SuggestBook, "terms" | "atHandHomes" | "editions" | "cover"> {
  fineTerms: SuggestTerm[];
  workTypeName: string | null;
  originalYear: number | null;
  workCover: string | null;
  editions: QueueEdition[];
}

export async function loadBooks(execute: Execute, homeId: string | null): Promise<Row[]> {
  return rowsOf<Row>(
    await execute(sql`
      with q as (select work_id, edition_id, row_number() over (order by position, work_id) as place from reading_queue),
      rd as (
        select r.work_id, count(*) filter (where r.status = 'finished') as finished, bool_or(r.status in ('reading', 'paused')) as open,
          max(r.finished_on) filter (where r.status = 'finished') as last_finished
        from readings r group by r.work_id
      )
      select w.id::text as id, w.title, w.slug, w.is_favourite as "isFavourite", w.is_poison as "isPoison",
        w.catalogue_status::text as "catalogueStatus", w.rating::float8 as rating, (${tasteRatingSql(sql`w.id`)})::float8 as taste,
        coalesce(rd.finished, 0)::int as "finishedCount", coalesce(rd.open, false) as open, rd.work_id is not null as "hasReading",
        rd.last_finished::text as "lastFinishedOn",
        (rd.last_finished is not null and exists (select 1 from readings o where o.work_id = w.id
          and coalesce(o.started_on, o.created_at::date) > rd.last_finished)) as "readSinceFinish",
        w.series_id::text as "seriesId", s.title as "seriesTitle", w.series_position as "seriesPosition",
        w.work_type_id::text as "workTypeId", wt.name as "workTypeName", w.original_language as "originalLanguage", w.original_year::int as "originalYear",
        ${ownedBookCondition(sql`w.id`)} as owned,
        q.place::int as "queuePlace", q.edition_id::text as "queueEditionId",
        (select min(i.acquisition_date)::text from instances i join editions e on e.id = i.edition_id
          where e.work_id = w.id and i.status <> 'deaccessioned') as "firstAcquired",
        (select max(i.acquisition_date)::text from instances i join editions e on e.id = i.edition_id
          where e.work_id = w.id and i.status <> 'deaccessioned') as "lastAcquired",
        (${atHandCopySql(sql`w.id`, homeId)} limit 1)::text as "atHandCopyId",
        coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'slug', a.slug) order by wa.sort_order, a.name)
          from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id and ${WRITER}), '[]'::jsonb) as authors,
        coalesce((select array_agg(distinct ec.author_id::text) from edition_contributors ec join editions e on e.id = ec.edition_id
          where e.work_id = w.id and ec.role = 'translator'), '{}') as "translatorIds",
        coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by r.name)
          from work_recommenders wr join recommenders r on r.id = wr.recommender_id where wr.work_id = w.id), '[]'::jsonb) as recommenders,
        coalesce((select jsonb_agg(jsonb_build_object('key', t.key, 'name', t.name) order by t.key) from (
            select 's:' || x.subject_id as key, y.name from work_subjects x join subjects y on y.id = x.subject_id where x.work_id = w.id
            union all select 't:' || x.theme_id, y.name from work_themes x join themes y on y.id = x.theme_id where x.work_id = w.id
            union all select 'm:' || x.literary_movement_id, y.name from work_literary_movements x join literary_movements y on y.id = x.literary_movement_id where x.work_id = w.id
            union all select 'c:' || x.category_id, y.name from work_categories x join book_categories y on y.id = x.category_id where x.work_id = w.id
            union all select 'a:' || x.attribute_id, y.name from work_attributes x join attributes y on y.id = x.attribute_id where x.work_id = w.id
            union all select 'k:' || x.keyword_id, y.name from work_keywords x join keywords y on y.id = x.keyword_id where x.work_id = w.id
          ) t), '[]'::jsonb) as "fineTerms",
        (select m.thumbnail_s3_key from media m where m.work_id = w.id and m.type = 'poster' and m.is_active order by m.sort_order limit 1) as "workCover",
        coalesce((select jsonb_agg(jsonb_build_object(
            'id', e.id, 'title', e.title, 'language', e.language, 'pageCount', e.page_count, 'thumbnail', e.thumbnail_s3_key,
            'audioMinutes', (select r.total_minutes from readings r where r.edition_id = e.id and r.total_minutes is not null
              order by coalesce(r.finished_on, r.started_on) desc nulls last, r.created_at desc limit 1),
            'copies', coalesce((select jsonb_agg(jsonb_build_object(
                'id', i.id, 'status', i.status, 'format', i.format, 'locationId', i.location_id, 'locationType', l.type,
                'locationName', l.name, 'subLocationName', sl.name, 'lentTo', i.lent_to, 'lentDate', i.lent_date::text)
                order by i.created_at, i.id)
              from instances i left join locations l on l.id = i.location_id left join sub_locations sl on sl.id = i.sub_location_id
              where i.edition_id = e.id), '[]'::jsonb))
            order by e.publication_year nulls last, e.created_at, e.id)
          from editions e where e.work_id = w.id), '[]'::jsonb) as editions,
        (select jsonb_build_object('verdict', f.verdict, 'reasons', f.reasons, 'note', f.note, 'until', f.until::text, 'source', f.source,
            'createdAt', f.created_at, 'updatedAt', f.updated_at)
          from recommendation_feedback f where f.work_id = w.id) as feedback
      from works w
      left join series s on s.id = w.series_id
      left join work_types wt on wt.id = w.work_type_id
      left join rd on rd.work_id = w.id
      left join q on q.work_id = w.id
      where w.kind = 'book'
      order by w.title, w.id`),
  );
}

/** The fine terms, plus the work type, the original language and the century */
export function termsOf(row: Row): SuggestTerm[] {
  const terms = [...row.fineTerms];
  if (row.workTypeId) terms.push({ key: `wt:${row.workTypeId}`, name: row.workTypeName ?? "Work type" });
  if (row.originalLanguage) terms.push({ key: `l:${row.originalLanguage}`, name: languageName(row.originalLanguage) ?? row.originalLanguage });
  if (row.originalYear) {
    const century = Math.floor((row.originalYear - 1) / 100) + 1;
    terms.push({ key: `cy:${century}`, name: centuryName(century) });
  }
  return terms;
}

/** The rows as the engine's books, with the homes where a copy is at hand */
export function toBooks(rows: Row[], homes: SuggestHome[]): SuggestBook[] {
  return rows.map(({ fineTerms, workTypeName, originalYear, workCover, ...row }) => {
    const copies = row.editions.flatMap((e) => e.copies);
    return {
      ...row,
      feedback: row.feedback as SuggestFeedback | null,
      terms: termsOf({ ...row, fineTerms, workTypeName, originalYear, workCover }),
      atHandHomes: homes.filter((h) => copies.some((c) => isAtHand(c, h.id))).map((h) => h.id),
      cover: workCover,
    };
  });
}
