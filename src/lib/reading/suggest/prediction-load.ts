import { sql } from "drizzle-orm";
import { WORK_AUTHOR_ROLES } from "@/lib/types";
import { tasteRatingSql } from "../summary";
import { buildContext } from "./build";
import { rowsOf, termsOf, type Execute, type Row } from "./load";
import type { SuggestBook, SuggestContext } from "./types";

/** Only the fields used by predict(), its evidence text and the daily gate. */
export type PredictionRow = Pick<
  Row,
  | "id"
  | "title"
  | "slug"
  | "taste"
  | "authors"
  | "translatorIds"
  | "recommenders"
  | "seriesId"
  | "seriesTitle"
  | "seriesPosition"
  | "workTypeId"
  | "workTypeName"
  | "originalLanguage"
  | "originalYear"
  | "fineTerms"
>;
export interface PredictionLoad {
  books: PredictionRow[];
  bookCount: number;
  termCounts: { key: string; count: number }[];
}

const WRITER = sql.raw(
  `wa.role in (${WORK_AUTHOR_ROLES.map((r) => `'${r}'`).join(", ")})`,
);

/** Target plus taste-evidence neighbours; all other books contribute term counts only. */
export async function loadPrediction(
  execute: Execute,
  workId: string,
): Promise<PredictionLoad> {
  const [load] = rowsOf<PredictionLoad>(
    await execute(sql`
    with library as materialized (
      select w.id, w.title, w.slug, w.series_id, w.series_position, w.work_type_id, w.original_language, w.original_year,
        (${tasteRatingSql(sql`w.id`)})::float8 as taste
      from works w where w.kind = 'book'
    ), selected as materialized (select * from library where id = ${workId}::uuid or taste is not null),
    fine as (
      select x.work_id, 's:' || x.subject_id as key from work_subjects x
      union all select x.work_id, 't:' || x.theme_id from work_themes x
      union all select x.work_id, 'm:' || x.literary_movement_id from work_literary_movements x
      union all select x.work_id, 'c:' || x.category_id from work_categories x
      union all select x.work_id, 'a:' || x.attribute_id from work_attributes x
      union all select x.work_id, 'k:' || x.keyword_id from work_keywords x
    ), library_terms as (
      select f.work_id, f.key from fine f join library w on w.id = f.work_id
      union all select id, 'wt:' || work_type_id from library where work_type_id is not null
      union all select id, 'l:' || original_language from library where original_language <> ''
      union all select id, 'cy:' || (floor((original_year - 1)::numeric / 100) + 1)::int from library where original_year <> 0
    ), counts as (select key, count(distinct work_id)::int as count from library_terms group by key),
    named_terms as (
      select x.work_id, 's:' || x.subject_id as key, y.name from work_subjects x join selected w on w.id = x.work_id join subjects y on y.id = x.subject_id
      union all select x.work_id, 't:' || x.theme_id, y.name from work_themes x join selected w on w.id = x.work_id join themes y on y.id = x.theme_id
      union all select x.work_id, 'm:' || x.literary_movement_id, y.name from work_literary_movements x join selected w on w.id = x.work_id join literary_movements y on y.id = x.literary_movement_id
      union all select x.work_id, 'c:' || x.category_id, y.name from work_categories x join selected w on w.id = x.work_id join book_categories y on y.id = x.category_id
      union all select x.work_id, 'a:' || x.attribute_id, y.name from work_attributes x join selected w on w.id = x.work_id join attributes y on y.id = x.attribute_id
      union all select x.work_id, 'k:' || x.keyword_id, y.name from work_keywords x join selected w on w.id = x.work_id join keywords y on y.id = x.keyword_id
    ), books as (
      select w.id::text as id, w.title, w.slug, w.taste, w.series_id::text as "seriesId", s.title as "seriesTitle", w.series_position as "seriesPosition",
        w.work_type_id::text as "workTypeId", wt.name as "workTypeName", w.original_language as "originalLanguage", w.original_year::int as "originalYear",
        coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'slug', a.slug) order by wa.sort_order, a.name)
          from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id and ${WRITER}), '[]'::jsonb) as authors,
        coalesce((select array_agg(distinct ec.author_id::text) from edition_contributors ec join editions e on e.id = ec.edition_id
          where e.work_id = w.id and ec.role = 'translator'), '{}') as "translatorIds",
        coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) order by r.name)
          from work_recommenders wr join recommenders r on r.id = wr.recommender_id where wr.work_id = w.id), '[]'::jsonb) as recommenders,
        coalesce((select jsonb_agg(jsonb_build_object('key', t.key, 'name', t.name) order by t.key)
          from named_terms t where t.work_id = w.id), '[]'::jsonb) as "fineTerms"
      from selected w left join series s on s.id = w.series_id left join work_types wt on wt.id = w.work_type_id
    )
    select coalesce((select jsonb_agg(b order by b.title, b.id) from books b), '[]'::jsonb) as books,
      (select count(*)::int from library) as "bookCount",
      coalesce((select jsonb_agg(c order by c.key) from counts c), '[]'::jsonb) as "termCounts"
  `),
  );
  return load;
}

/** Prediction-only context. Queue, holdings, feedback and pace are intentionally absent from the load. */
export function buildPredictionContext(load: PredictionLoad): SuggestContext {
  const books: SuggestBook[] = load.books.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    taste: row.taste,
    authors: row.authors,
    translatorIds: row.translatorIds,
    recommenders: row.recommenders,
    seriesId: row.seriesId,
    seriesTitle: row.seriesTitle,
    seriesPosition: row.seriesPosition,
    workTypeId: row.workTypeId,
    originalLanguage: row.originalLanguage,
    terms: termsOf(row),
    // Neutral values satisfy the existing engine contract; predictions never read them.
    rating: null,
    isFavourite: false,
    isPoison: false,
    catalogueStatus: "accessioned",
    finishedCount: 0,
    open: false,
    hasReading: false,
    lastFinishedOn: null,
    readSinceFinish: false,
    owned: false,
    queuePlace: null,
    queueEditionId: null,
    firstAcquired: null,
    lastAcquired: null,
    atHandCopyId: null,
    atHandHomes: [],
    editions: [],
    cover: null,
    feedback: null,
  }));
  const ctx = buildContext({
    today: "",
    homeId: null,
    homes: [],
    books,
    queueLength: 0,
    priors: { byLanguageFormat: {}, byFormat: {}, overall: null },
    hideAnathema: false,
    gate: null,
  });
  ctx.idf = new Map(
    load.termCounts.map(({ key, count }) => [
      key,
      Math.log((load.bookCount + 1) / (count + 1)),
    ]),
  );
  return ctx;
}
