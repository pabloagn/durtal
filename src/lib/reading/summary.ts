import { sql, type SQL } from "drizzle-orm";

/*
 * A book's reading state and counts, as SQL fragments over a work id column
 * (SLN-444). No view: callers put them in their own selects. Every number is
 * cast to float8, since raw SQL returns numeric as a string.
 */

const OPEN = sql.raw(`('reading','paused')`);

/** The open reading's status, else read, else abandoned, else unread */
export function readingStateSql(workId: SQL | unknown): SQL<"unread" | "reading" | "paused" | "read" | "abandoned"> {
  return sql`coalesce(
    (select r.status from readings r where r.work_id = ${workId} and r.status in ${OPEN} limit 1),
    case
      when exists (select 1 from readings r where r.work_id = ${workId} and r.status = 'finished') then 'read'
      when exists (select 1 from readings r where r.work_id = ${workId} and r.status = 'abandoned') then 'abandoned'
      else 'unread'
    end)`;
}

/** Finished readings only: "Read 3 times" never counts abandoned or open ones */
export function readCountSql(workId: SQL | unknown) {
  return sql<number>`(select count(*)::float8 from readings r where r.work_id = ${workId} and r.status = 'finished')`.mapWith(Number);
}

const latestFinished = (workId: SQL | unknown, column: string) =>
  sql`(select r.${sql.raw(column)} from readings r where r.work_id = ${workId} and r.status = 'finished'
    order by r.finished_on desc nulls last, r.created_at desc, r.id desc limit 1)`;

/** The latest finished reading's finish date ("YYYY-MM-DD") */
export function lastFinishedOnSql(workId: SQL | unknown) {
  return sql<string | null>`${latestFinished(workId, "finished_on")}::text`;
}

/** The latest finished reading's finish precision */
export function lastFinishedPrecisionSql(workId: SQL | unknown) {
  return sql<string | null>`${latestFinished(workId, "finished_precision")}`;
}

/**
 * A finished reading in these years: its finish date's year, at any
 * precision (a month or a year date counts in its year). Either end may be open.
 */
export function readInCondition(workId: SQL | unknown, from?: number, to?: number) {
  return sql`exists (select 1 from readings r where r.work_id = ${workId} and r.status = 'finished'
    and r.finished_precision <> 'unknown' and r.finished_on is not null
    ${from !== undefined ? sql`and extract(year from r.finished_on) >= ${from}` : sql``}
    ${to !== undefined ? sql`and extract(year from r.finished_on) <= ${to}` : sql``})`;
}

/**
 * The last time the book was read: the later of its last progress and its
 * last finish date (a past read or an import has a finish date and no
 * progress). The library's "Last read" sort.
 */
export function lastReadAtSql(workId: SQL | unknown) {
  return sql<string | null>`(select greatest(max(r.last_read_at), max(r.finished_on)::timestamptz) from readings r where r.work_id = ${workId})`;
}

/** The open reading's share read, 0 to 100 */
export function openReadingPercentSql(workId: SQL | unknown) {
  return sql<number | null>`(select r.current_percent::float8 from readings r where r.work_id = ${workId} and r.status in ${OPEN} limit 1)`;
}

/**
 * A reading's number among its book's readings: all of them, abandoned
 * included, by the earlier of its known dates (unknown first); ties by source
 * key, then creation, then id; the open reading always last. One window
 * function over `readings` aliased as `readingAlias`.
 */
export function readingOrdinalSql(readingAlias: string) {
  const r = sql.raw(readingAlias);
  return sql<number>`(row_number() over (partition by ${r}.work_id order by ${readingOrder(readingAlias)}))::float8`.mapWith(Number);
}

/** The order of a book's readings that `readingOrdinalSql` numbers by */
function readingOrder(readingAlias: string) {
  const r = sql.raw(readingAlias);
  return sql`(${r}.status in ${OPEN}) asc,
    coalesce(${r}.started_on, ${r}.finished_on) asc nulls first,
    ${r}.source_key asc nulls last, ${r}.created_at asc, ${r}.id asc`;
}

/**
 * A re-read: the book has a finished reading before this one in the order of
 * `readingOrdinalSql`. An abandoned first attempt does not count. One window
 * over `readings` aliased as `readingAlias`, so it goes in a select over all
 * of a book's readings, before any filter.
 */
export function rereadSql(readingAlias: string) {
  const r = sql.raw(readingAlias);
  return sql<boolean>`(count(*) filter (where ${r}.status = 'finished') over (partition by ${r}.work_id order by ${readingOrder(readingAlias)}
    rows between unbounded preceding and 1 preceding) > 0)`;
}

/**
 * The pages read, one row per counted unit: reading_id, work_id, session_id
 * (null for a finished reading without sessions), day, day_precision, format
 * and pages (float8, not rounded). Callers filter by period, sum, then round.
 * A session counts only past the furthest point reached before it, as a share
 * of the page total it was logged against; the running timer and sessions
 * without an end share or a page total count nothing. A finished reading with
 * no sessions counts its pages from its start page, in its finish period.
 */
export function countedPagesSql() {
  return sql`(
    select s.reading_id, r.work_id, s.id as session_id, s.read_on as day, 'day'::text as day_precision, s.format,
      greatest(0, coalesce(s.end_percent::float8, 0)
        - greatest(coalesce(r.start_percent::float8, 0),
          coalesce(max(s.end_percent::float8) over (partition by s.reading_id
            order by s.read_on, coalesce(s.ended_at, s.started_at, s.created_at), s.created_at
            rows between unbounded preceding and 1 preceding), 0)))
        * coalesce(s.pages_total, r.total_pages, 0)::float8 / 100
        * (case when s.end_percent is null or coalesce(s.pages_total, r.total_pages) is null then 0 else 1 end) as pages
    from reading_sessions s join readings r on r.id = s.reading_id
    where not (s.source = 'timer' and s.ended_at is null)
    union all
    select r.id, r.work_id, null::uuid, r.finished_on, r.finished_precision, r.format,
      greatest(0, coalesce(r.total_pages, 0) - coalesce(r.start_page, 0))::float8
    from readings r
    where r.status = 'finished'
      and not exists (select 1 from reading_sessions s where s.reading_id = r.id and not (s.source = 'timer' and s.ended_at is null))
  )`;
}

/**
 * A read's rating: its own, else the book's when it is the book's only
 * finished reading. `readingAlias` names a `readings` row.
 */
export function readingRatingSql(readingAlias: string) {
  const r = sql.raw(readingAlias);
  return sql<number | null>`coalesce(${r}.rating::float8,
    case when ${r}.status = 'finished'
      and (select count(*) from readings o where o.work_id = ${r}.work_id and o.status = 'finished') = 1
    then (select w.rating::float8 from works w where w.id = ${r}.work_id) end)`;
}

/**
 * Taste evidence: the book's rating of a book with at least one finished
 * reading (else the latest finished reading's rating). A rating on a book
 * never finished is never evidence: it may be a seed priority.
 */
export function tasteRatingSql(workId: SQL | unknown) {
  return sql<number | null>`(case when exists (select 1 from readings r where r.work_id = ${workId} and r.status = 'finished')
    then coalesce((select w.rating::float8 from works w where w.id = ${workId}),
      (select r.rating::float8 from readings r where r.work_id = ${workId} and r.status = 'finished' and r.rating is not null
        order by r.finished_on desc nulls last, r.created_at desc limit 1)) end)`;
}
