/**
 * The reading hub's queries (SLN-448): the journal (every reading, filtered,
 * sorted and paged on the server) and the recently finished reads. Every
 * rating here is the read's rating (`readingRatingSql`), never the book's
 * alone; a re-read follows `rereadSql`.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { textSearchCondition } from "@/lib/actions/utils/text-search";
import type { ReadingDatePrecision, ReadingFormat, ReadingStatus } from "./constants";
import { readingRatingSql, rereadSql } from "./summary";
import type { JournalQuery } from "./journal-params";

export interface JournalRow {
  id: string;
  workId: string;
  title: string;
  slug: string | null;
  author: string | null;
  cover: string | null;
  status: ReadingStatus;
  startedOn: string | null;
  startedPrecision: ReadingDatePrecision;
  finishedOn: string | null;
  finishedPrecision: ReadingDatePrecision;
  format: ReadingFormat;
  rating: number | null;
  reread: boolean;
  editionLanguage: string | null;
  originalLanguage: string | null;
  fingerprint: string;
}

export interface JournalSummary {
  readings: number;
  finished: number;
  abandoned: number;
  rereads: number;
}

/**
 * Every reading with its read's rating, whether it is a re-read and its
 * year of finish (the stop date for an abandoned one). The windows run over
 * all readings, before any filter.
 */
const base = sql`(
  select r.id, r.work_id, r.status, r.started_on, r.started_precision, r.finished_on, r.finished_precision,
    r.format, r.edition_id, r.last_read_at, r.created_at,
    md5(to_jsonb(r)::text) as fingerprint,
    ${readingRatingSql("r")} as read_rating,
    ${rereadSql("r")} as reread,
    case when r.finished_precision <> 'unknown' and r.finished_on is not null then extract(year from r.finished_on)::int end as finish_year
  from readings r
)`;

const authorsOf = sql`coalesce((select string_agg(a.name, ' ') from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id), '')`;

function conditions(q: JournalQuery): SQL {
  const parts: SQL[] = [sql`w.kind = 'book'`];
  if (q.status.length) parts.push(sql`b.status in (${sql.join(q.status.map((s) => sql`${s}`), sql`, `)})`);
  if (q.yearMin !== undefined) parts.push(sql`b.finish_year >= ${q.yearMin}`);
  if (q.yearMax !== undefined) parts.push(sql`b.finish_year <= ${q.yearMax}`);
  if (q.formats.length) parts.push(sql`b.format in (${sql.join(q.formats.map((f) => sql`${f}`), sql`, `)})`);
  if (q.minRating !== undefined) parts.push(sql`b.read_rating >= ${q.minRating}`);
  if (q.rereads) parts.push(sql`b.reread`);
  const text = q.q ? textSearchCondition(sql`search_normalize(w.title || ' ' || ${authorsOf})`, q.q, { fuzzy: false }) : undefined;
  if (text) parts.push(text);
  return sql.join(parts, sql` and `);
}

function orderBy(q: JournalQuery): SQL {
  const desc = q.order === "desc";
  const dir = sql.raw(desc ? "desc" : "asc");
  const open = sql`(b.status in ('reading','paused'))`;
  if (q.sort === "finished") {
    // Newest first: in progress, then each year, then unknown dates; oldest first: years, in progress, unknown
    const group = desc
      ? sql`case when ${open} then 0 when b.finish_year is not null then 1 else 2 end`
      : sql`case when b.finish_year is not null then 0 when ${open} then 1 else 2 end`;
    return sql`${group} asc, b.finished_on ${dir} nulls last, b.last_read_at desc nulls last, b.id asc`;
  }
  if (q.sort === "started")
    return sql`(b.started_precision = 'unknown' or b.started_on is null) asc, b.started_on ${dir} nulls last, b.id asc`;
  if (q.sort === "rating") return sql`b.read_rating ${dir} nulls last, b.id asc`;
  return sql`lower(w.title) ${dir}, b.id asc`;
}

export async function queryJournal(q: JournalQuery) {
  const where = conditions(q);
  const [rows, [summary]] = await Promise.all([
    db.execute(sql`select b.id, b.work_id as "workId", w.title, w.slug,
        (select a.name from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id order by wa.sort_order limit 1) as author,
        coalesce((select coalesce(e.thumbnail_s3_key, e.cover_s3_key) from editions e where e.id = b.edition_id),
          (select m.thumbnail_s3_key from media m where m.work_id = w.id and m.type = 'poster' and m.is_active order by m.sort_order limit 1)) as cover,
        b.status, b.started_on::text as "startedOn", b.started_precision as "startedPrecision",
        b.finished_on::text as "finishedOn", b.finished_precision as "finishedPrecision", b.format,
        b.read_rating as rating, b.reread,
        (select e.language from editions e where e.id = b.edition_id) as "editionLanguage", w.original_language as "originalLanguage",
        b.fingerprint
      from ${base} b join works w on w.id = b.work_id
      where ${where}
      order by ${orderBy(q)}
      limit ${q.perPage} offset ${q.offset}`),
    db.execute(sql`select count(*)::int as readings,
        count(*) filter (where b.status = 'finished')::int as finished,
        count(*) filter (where b.status = 'abandoned')::int as abandoned,
        count(*) filter (where b.reread)::int as rereads
      from ${base} b join works w on w.id = b.work_id where ${where}`).then((r) => resultRows<JournalSummary>(r)),
  ]);
  return {
    rows: resultRows<JournalRow>(rows),
    summary: summary ?? { readings: 0, finished: 0, abandoned: 0, rereads: 0 },
  };
}

/** The journal filters' choices, from every reading: the years of finish and the formats */
export async function getJournalFacets() {
  const [[years], formats] = await Promise.all([
    db
      .execute(sql`select min(extract(year from finished_on))::int as min, max(extract(year from finished_on))::int as max
        from readings where finished_precision <> 'unknown' and finished_on is not null`)
      .then((r) => resultRows<{ min: number | null; max: number | null }>(r)),
    db.execute(sql`select distinct format from readings order by format`).then((r) => resultRows<{ format: ReadingFormat }>(r).map((f) => f.format)),
  ]);
  return { yearRange: years ?? { min: null, max: null }, formats };
}

export interface FinishedRead {
  id: string;
  workId: string;
  title: string;
  slug: string | null;
  cover: string | null;
  finishedOn: string | null;
  finishedPrecision: ReadingDatePrecision;
  rating: number | null;
}

/** The latest finished reads, newest first; unknown dates last */
export async function getRecentlyFinished(limit: number): Promise<FinishedRead[]> {
  return resultRows<FinishedRead>(
    await db.execute(sql`select r.id, r.work_id as "workId", w.title, w.slug,
        coalesce((select coalesce(e.thumbnail_s3_key, e.cover_s3_key) from editions e where e.id = r.edition_id),
          (select m.thumbnail_s3_key from media m where m.work_id = w.id and m.type = 'poster' and m.is_active order by m.sort_order limit 1)) as cover,
        r.finished_on::text as "finishedOn", r.finished_precision as "finishedPrecision", ${readingRatingSql("r")} as rating
      from readings r join works w on w.id = r.work_id
      where r.status = 'finished'
      order by r.finished_on desc nulls last, r.last_read_at desc nulls last, r.created_at desc, r.id
      limit ${limit}`),
  );
}
