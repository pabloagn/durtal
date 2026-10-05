import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { ownedBookCondition } from "@/lib/catalogue/holdings";
import { getPaceContext } from "@/lib/actions/reading";
import { predictionGateSchema, type PredictionGate } from "@/lib/validations/settings";
import { languageName } from "@/lib/utils/language";
import { atHandCopySql, homeOptions, isAtHand } from "../at-hand";
import { readingToday } from "../day";
import { tasteRatingSql } from "../summary";
import type { QueueEdition } from "../queue";
import { buildContext } from "./build";
import { evaluatePredictions, gateDue, nextGate } from "./predict";
import type { SuggestBook, SuggestContext, SuggestFeedback, SuggestTerm } from "./types";

/*
 * getSuggestionContext (SLN-457): every book with what the engine needs, in
 * one query (authors, translators, recommenders, taxonomy, series, copies,
 * Up Next, feedback, taste evidence), plus the homes, Up Next's length, his
 * pace and two settings. Computed per request and never cached, so a copy
 * added, moved or lent shows on the next request. Only the prediction gate's
 * daily check is stored.
 */

/** "19th century" */
export function centuryName(century: number): string {
  const tens = century % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[century % 10] ?? "th";
  return `${century}${suffix} century`;
}

interface Row extends Omit<SuggestBook, "terms" | "atHandHomes" | "editions" | "cover"> {
  fineTerms: SuggestTerm[];
  workTypeName: string | null;
  originalYear: number | null;
  workCover: string | null;
  editions: QueueEdition[];
}

async function loadBooks(homeId: string | null): Promise<Row[]> {
  return resultRows<Row>(
    await db.execute(sql`
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
          from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id and wa.role = 'author'), '[]'::jsonb) as authors,
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
function termsOf(row: Row): SuggestTerm[] {
  const terms = [...row.fineTerms];
  if (row.workTypeId) terms.push({ key: `wt:${row.workTypeId}`, name: row.workTypeName ?? "Work type" });
  if (row.originalLanguage) terms.push({ key: `l:${row.originalLanguage}`, name: languageName(row.originalLanguage) ?? row.originalLanguage });
  if (row.originalYear) {
    const century = Math.floor((row.originalYear - 1) / 100) + 1;
    terms.push({ key: `cy:${century}`, name: centuryName(century) });
  }
  return terms;
}

/** Runs the gate's daily check when it is due: one UPDATE asserting the old checkedAt, so two requests never both write it */
async function ensureGate(ctx: SuggestContext, previous: PredictionGate | null, now: Date): Promise<PredictionGate | null> {
  if (!gateDue(previous, now)) return previous;
  const next = nextGate(previous, evaluatePredictions(ctx), now);
  const rows = resultRows<{ gate: unknown }>(
    await db.execute(sql`update app_settings set reading_prediction_gate = ${JSON.stringify(next)}::jsonb
      where ${previous ? sql`reading_prediction_gate->>'checkedAt' = ${previous.checkedAt}` : sql`reading_prediction_gate is null`}
      returning reading_prediction_gate as gate`),
  );
  if (rows.length) {
    invalidate(CACHE_TAGS.settings);
    return next;
  }
  // Another request ran it first, or there is no settings row: read what is stored
  const [stored] = resultRows<{ gate: unknown }>(await db.execute(sql`select reading_prediction_gate as gate from app_settings limit 1`));
  const parsed = predictionGateSchema.safeParse(stored?.gate);
  return parsed.success ? parsed.data : previous;
}

/** Everything the engine reads, for the remembered home (the durtal-reading-home cookie), else none */
export async function getSuggestionContext({ homeId = null, now = new Date() }: { homeId?: string | null; now?: Date } = {}): Promise<SuggestContext> {
  const [today, settingsRows, places, rows, pace, queue] = await Promise.all([
    readingToday(),
    db.execute(sql`select reading_suggest_hide_anathema as "hideAnathema", reading_prediction_gate as gate from app_settings limit 1`),
    db.execute(sql`select id::text as id, name, type, is_active as "isActive" from locations order by name`),
    loadBooks(homeId),
    getPaceContext([]),
    db.execute(sql`select count(*)::int as n from reading_queue`),
  ]);
  const [settings] = resultRows<{ hideAnathema: boolean; gate: unknown }>(settingsRows);
  const homes = homeOptions(resultRows<{ id: string; name: string; type: string; isActive: boolean }>(places)).map((h) => ({ id: h.id, name: h.name }));
  const parsedGate = predictionGateSchema.safeParse(settings?.gate);
  const books: SuggestBook[] = rows.map(({ fineTerms: _fine, workTypeName: _type, originalYear: _year, workCover, ...row }) => {
    const copies = row.editions.flatMap((e) => e.copies);
    return {
      ...row,
      feedback: row.feedback as SuggestFeedback | null,
      terms: termsOf({ ...row, fineTerms: _fine, workTypeName: _type, originalYear: _year, workCover }),
      atHandHomes: homes.filter((h) => copies.some((c) => isAtHand(c, h.id))).map((h) => h.id),
      cover: workCover,
    };
  });
  const ctx = buildContext({
    today,
    homeId,
    homes,
    books,
    queueLength: resultRows<{ n: number }>(queue)[0]?.n ?? 0,
    priors: pace.priors,
    hideAnathema: settings?.hideAnathema ?? false,
    gate: parsedGate.success ? parsedGate.data : null,
  });
  ctx.gate = await ensureGate(ctx, ctx.gate, now);
  return ctx;
}
