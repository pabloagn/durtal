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
      ),
      -- Grouped once for every book, not once per book: the writers, the fine terms and the editions with their copies
      au as (
        select wa.work_id, jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'slug', a.slug) order by wa.sort_order, a.name) as authors
        from work_authors wa join authors a on a.id = wa.author_id where ${WRITER} group by wa.work_id
      ),
      ft as (
        select t.work_id, jsonb_agg(jsonb_build_object('key', t.key, 'name', t.name) order by t.key) as terms from (
          select x.work_id, 's:' || x.subject_id as key, y.name from work_subjects x join subjects y on y.id = x.subject_id
          union all select x.work_id, 't:' || x.theme_id, y.name from work_themes x join themes y on y.id = x.theme_id
          union all select x.work_id, 'm:' || x.literary_movement_id, y.name from work_literary_movements x join literary_movements y on y.id = x.literary_movement_id
          union all select x.work_id, 'c:' || x.category_id, y.name from work_categories x join book_categories y on y.id = x.category_id
          union all select x.work_id, 'a:' || x.attribute_id, y.name from work_attributes x join attributes y on y.id = x.attribute_id
          union all select x.work_id, 'k:' || x.keyword_id, y.name from work_keywords x join keywords y on y.id = x.keyword_id
        ) t group by t.work_id
      ),
      am as (
        select distinct on (r.edition_id) r.edition_id, r.total_minutes from readings r
        where r.edition_id is not null and r.total_minutes is not null
        order by r.edition_id, coalesce(r.finished_on, r.started_on) desc nulls last, r.created_at desc
      ),
      cp as (
        select i.edition_id, jsonb_agg(jsonb_build_object(
            'id', i.id, 'status', i.status, 'format', i.format, 'locationId', i.location_id, 'locationType', l.type,
            'locationName', l.name, 'subLocationName', sl.name, 'lentTo', i.lent_to, 'lentDate', i.lent_date::text)
            order by i.created_at, i.id) as copies
        from instances i left join locations l on l.id = i.location_id left join sub_locations sl on sl.id = i.sub_location_id
        group by i.edition_id
      ),
      ed as (
        select e.work_id, jsonb_agg(jsonb_build_object(
            'id', e.id, 'title', e.title, 'language', e.language, 'pageCount', e.page_count, 'thumbnail', e.thumbnail_s3_key,
            'audioMinutes', am.total_minutes, 'copies', coalesce(cp.copies, '[]'::jsonb))
            order by e.publication_year nulls last, e.created_at, e.id) as editions
        from editions e left join am on am.edition_id = e.id left join cp on cp.edition_id = e.id
        group by e.work_id
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
        coalesce(au.authors, '[]'::jsonb) as authors,
        coalesce((select array_agg(distinct ec.author_id::text) from edition_contributors ec join editions e on e.id = ec.edition_id
          where e.work_id = w.id and ec.role = 'translator'), '{}') as "translatorIds",
        coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by r.name)
          from work_recommenders wr join recommenders r on r.id = wr.recommender_id where wr.work_id = w.id), '[]'::jsonb) as recommenders,
        coalesce(ft.terms, '[]'::jsonb) as "fineTerms",
        (select m.thumbnail_s3_key from media m where m.work_id = w.id and m.type = 'poster' and m.is_active order by m.sort_order limit 1) as "workCover",
        coalesce(ed.editions, '[]'::jsonb) as editions,
        (select jsonb_build_object('verdict', f.verdict, 'reasons', f.reasons, 'note', f.note, 'until', f.until::text, 'source', f.source,
            'createdAt', f.created_at, 'updatedAt', f.updated_at)
          from recommendation_feedback f where f.work_id = w.id) as feedback
      from works w
      left join series s on s.id = w.series_id
      left join work_types wt on wt.id = w.work_type_id
      left join rd on rd.work_id = w.id
      left join q on q.work_id = w.id
      left join au on au.work_id = w.id
      left join ft on ft.work_id = w.id
      left join ed on ed.work_id = w.id
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
