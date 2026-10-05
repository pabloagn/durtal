import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { ownedBookCondition } from "@/lib/catalogue/holdings";
import { atHandCopySql, homeOptions } from "./at-hand";
import { countedPagesSql, readingOrdinalSql, readingRatingSql, readingStateSql, rereadSql, tasteRatingSql } from "./summary";
import { WORK_AUTHOR_ROLES } from "@/lib/types";

/*
 * Reading stats (SLN-456): every number of /reading/stats and the Year in
 * review, from a handful of aggregate queries per page, never one per book.
 * Each function takes a year, or null for all time, and returns plain
 * numbers (every numeric column and average cast to float8). Never cached:
 * stats are computed per request.
 *
 * Pages come only from countedPagesSql; hours and reading days leave out the
 * running timer; the read's rating (readingRatingSql) feeds every rating
 * number but the recommenders', which use taste evidence (tasteRatingSql).
 */

export type StatsYear = number | null;

/** Every reading with its re-read flag and the read's rating; windows run over all readings */
const BASE = sql`rr as (select r.*, ${rereadSql("r")} as reread, ${readingRatingSql("r")} as read_rating from readings r),
  cp as ${countedPagesSql()},
  ss as (select s.* from reading_sessions s where not (s.source = 'timer' and s.ended_at is null))`;

/** A finished reading in the period: a known finish in the year, or any finish for all time */
const finishedIn = (year: StatsYear, alias = "rr") => {
  const r = sql.raw(alias);
  return year === null
    ? sql`${r}.status = 'finished'`
    : sql`${r}.status = 'finished' and ${r}.finished_precision <> 'unknown' and extract(year from ${r}.finished_on) = ${year}`;
};

/** A dated thing in the period; all time keeps everything */
const dayIn = (year: StatsYear, day: SQL, precision: SQL = sql`'day'`) =>
  year === null ? sql`true` : sql`${day} is not null and ${precision} <> 'unknown' and extract(year from ${day}) = ${year}`;

/** A reading with anything in the period: a finish or stop, a session, or (all time) anything */
const activeIn = (year: StatsYear, alias = "rr") => {
  const r = sql.raw(alias);
  return year === null
    ? sql`true`
    : sql`((${r}.finished_precision <> 'unknown' and extract(year from ${r}.finished_on) = ${year})
        or exists (select 1 from ss where ss.reading_id = ${r}.id and extract(year from ss.read_on) = ${year}))`;
};

async function rows<T>(query: SQL): Promise<T[]> {
  return resultRows<T>(await db.execute(query));
}

/* ── 1. The year in numbers ─────────────────────────────────────────────── */

export interface YearNumbers {
  books: number;
  pages: number;
  hours: number;
  readingDays: number;
  avgRating: number | null;
  rereads: number;
  abandoned: number;
  avgLength: number | null;
  /** Audiobooks with no page count that read in the period: 0 pages each */
  audioWithoutPages: number;
  /** All time: finished readings with no known finish date (in the totals, in no chart) */
  undated: number;
}

export async function yearNumbers(year: StatsYear): Promise<YearNumbers> {
  const [row] = await rows<YearNumbers>(sql`with ${BASE}
    select
      (select count(*)::float8 from rr where ${finishedIn(year)}) as books,
      (select coalesce(round(sum(cp.pages)), 0)::float8 from cp where ${dayIn(year, sql`cp.day`, sql`cp.day_precision`)}) as pages,
      (select coalesce(sum(ss.duration_seconds), 0)::float8 / 3600 from ss where ${dayIn(year, sql`ss.read_on`)}) as hours,
      (select count(*)::float8 from (
        select ss.read_on as day from ss where ${dayIn(year, sql`ss.read_on`)}
        union select rr.finished_on from rr where rr.status = 'finished' and rr.finished_precision = 'day' and ${dayIn(year, sql`rr.finished_on`)}) d) as "readingDays",
      (select avg(rr.read_rating)::float8 from rr where ${finishedIn(year)} and rr.read_rating is not null) as "avgRating",
      (select count(*)::float8 from rr where ${finishedIn(year)} and rr.reread) as rereads,
      (select count(*)::float8 from rr where rr.status = 'abandoned' and ${year === null ? sql`true` : sql`rr.finished_precision <> 'unknown' and extract(year from rr.finished_on) = ${year}`}) as abandoned,
      (select avg(rr.total_pages)::float8 from rr where ${finishedIn(year)} and rr.total_pages is not null) as "avgLength",
      (select count(*)::float8 from rr where rr.format = 'audio' and rr.total_pages is null and ${activeIn(year)}) as "audioWithoutPages",
      (select count(*)::float8 from rr where rr.status = 'finished' and rr.finished_precision = 'unknown') as undated`);
  return row;
}

/* ── 2. Over the year ───────────────────────────────────────────────────── */

export interface PeriodBar {
  /** 1 to 12 for a year's months, the year for all time; null for "Month unknown" */
  key: number | null;
  books: number;
  pages: number;
}

/**
 * Books and pages by month (a year) or by year (all time). A year's readings
 * dated only by year go in a "Month unknown" bar; undated ones in no bar.
 */
export async function overTheYear(year: StatsYear): Promise<{ bars: PeriodBar[]; unknown: PeriodBar | null; undated: number }> {
  if (year === null) {
    const bars = await rows<PeriodBar>(sql`with ${BASE}
      select y.key::int as key, coalesce(b.books, 0)::float8 as books, coalesce(p.pages, 0)::float8 as pages
      from (select distinct extract(year from rr.finished_on)::int as key from rr where rr.status = 'finished' and rr.finished_on is not null
            union select distinct extract(year from cp.day)::int from cp where cp.day is not null) y
      left join (select extract(year from rr.finished_on)::int as key, count(*) as books from rr where rr.status = 'finished' and rr.finished_on is not null group by 1) b on b.key = y.key
      left join (select extract(year from cp.day)::int as key, round(sum(cp.pages)) as pages from cp where cp.day is not null group by 1) p on p.key = y.key
      order by 1`);
    const [{ undated }] = await rows<{ undated: number }>(sql`select count(*)::float8 as undated from readings where status = 'finished' and finished_precision = 'unknown'`);
    return { bars, unknown: null, undated };
  }
  const months = await rows<PeriodBar & { precision: string }>(sql`with ${BASE}
    select key, precision, sum(books)::float8 as books, round(sum(pages))::float8 as pages from (
      select case when rr.finished_precision = 'year' then null else extract(month from rr.finished_on)::int end as key,
        case when rr.finished_precision = 'year' then 'year' else 'month' end as precision, 1 as books, 0::float8 as pages
      from rr where ${finishedIn(year)}
      union all
      select case when cp.day_precision = 'year' then null else extract(month from cp.day)::int end,
        case when cp.day_precision = 'year' then 'year' else 'month' end, 0, cp.pages
      from cp where ${dayIn(year, sql`cp.day`, sql`cp.day_precision`)}
    ) u group by key, precision`);
  const bars = Array.from({ length: 12 }, (_, i) => {
    const m = months.find((r) => r.key === i + 1);
    return { key: i + 1, books: m?.books ?? 0, pages: m?.pages ?? 0 };
  });
  const unknown = months.find((r) => r.key === null);
  return { bars, unknown: unknown && (unknown.books || unknown.pages) ? { key: null, books: unknown.books, pages: unknown.pages } : null, undated: 0 };
}

/* ── 3. Reading days ────────────────────────────────────────────────────── */

export interface CalendarDay {
  day: string;
  minutes: number;
  pages: number;
}

export interface ReadingDaysStats {
  /** A year's days with reading (all time: none, the calendar is per year) */
  calendar: CalendarDay[];
  /** Minutes and sessions by local weekday, 1 Monday to 7 Sunday */
  weekdays: { weekday: number; minutes: number; sessions: number }[];
  /** Minutes and sessions by local part of day: night (0 to 5), morning (5 to 12), afternoon (12 to 17), evening (17 to 24) */
  partsOfDay: { part: "night" | "morning" | "afternoon" | "evening"; minutes: number; sessions: number }[];
  /** The weekday and part of day with the most minutes (else sessions) */
  peak: { weekday: number; part: string } | null;
  /** Sessions with no start time: in the weekday bars by their day, out of the parts of day */
  withoutStart: number;
}

export async function readingDays(year: StatsYear): Promise<ReadingDaysStats> {
  const period = dayIn(year, sql`ss.read_on`);
  const [calendar, grid] = await Promise.all([
    year === null
      ? Promise.resolve([] as CalendarDay[])
      : rows<CalendarDay>(sql`with ${BASE}
          select d.day::text as day, coalesce(sum(d.minutes), 0)::float8 as minutes, round(coalesce(sum(d.pages), 0))::float8 as pages from (
            select ss.read_on as day, ss.duration_seconds::float8 / 60 as minutes, 0::float8 as pages from ss where ${period}
            union all select cp.day, 0, cp.pages from cp where cp.session_id is not null and ${dayIn(year, sql`cp.day`)}
            union all select rr.finished_on, 0, 0 from rr where rr.status = 'finished' and rr.finished_precision = 'day' and ${dayIn(year, sql`rr.finished_on`)}
          ) d group by d.day order by d.day`),
    rows<{ weekday: number; part: string | null; minutes: number; sessions: number }>(sql`with ${BASE}
      select
        coalesce(extract(isodow from (ss.started_at at time zone ss.time_zone)), extract(isodow from ss.read_on))::int as weekday,
        case when ss.started_at is null then null
          when extract(hour from (ss.started_at at time zone ss.time_zone)) < 5 then 'night'
          when extract(hour from (ss.started_at at time zone ss.time_zone)) < 12 then 'morning'
          when extract(hour from (ss.started_at at time zone ss.time_zone)) < 17 then 'afternoon'
          else 'evening' end as part,
        coalesce(sum(ss.duration_seconds), 0)::float8 / 60 as minutes, count(*)::float8 as sessions
      from ss where ${period} group by 1, 2`),
  ]);
  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
    const at = grid.filter((g) => g.weekday === weekday);
    return { weekday, minutes: at.reduce((s, g) => s + g.minutes, 0), sessions: at.reduce((s, g) => s + g.sessions, 0) };
  });
  const partsOfDay = (["night", "morning", "afternoon", "evening"] as const).map((part) => {
    const at = grid.filter((g) => g.part === part);
    return { part, minutes: at.reduce((s, g) => s + g.minutes, 0), sessions: at.reduce((s, g) => s + g.sessions, 0) };
  });
  const timed = grid.some((g) => g.minutes > 0);
  const cells = grid.filter((g) => g.part);
  const top = [...cells].sort((a, b) => (timed ? b.minutes - a.minutes : b.sessions - a.sessions))[0];
  return {
    calendar,
    weekdays,
    partsOfDay,
    peak: top ? { weekday: top.weekday, part: top.part! } : null,
    withoutStart: grid.filter((g) => !g.part).reduce((s, g) => s + g.sessions, 0),
  };
}

/* ── 4. Ratings ─────────────────────────────────────────────────────────── */

export interface RatingsStats {
  /** Finished readings by the read's rating, 0.5 to 5 */
  distribution: { rating: number; count: number }[];
  /** Books finished in the period with two finished reads or more: each read's rating in order */
  reread: { workId: string; title: string; slug: string | null; reads: (number | null)[] }[];
  /** Re-reads rated higher than the read before */
  higherOnReread: number;
}

export async function ratings(year: StatsYear): Promise<RatingsStats> {
  const [distribution, reread] = await Promise.all([
    rows<{ rating: number; count: number }>(sql`with ${BASE}
      select rr.read_rating::float8 as rating, count(*)::float8 as count from rr
      where ${finishedIn(year)} and rr.read_rating is not null group by 1 order by 1`),
    rows<{ workId: string; title: string; slug: string | null; reads: (number | null)[] }>(sql`with ${BASE}
      select w.id::text as "workId", w.title, w.slug,
        (select array_agg(o.read_rating::float8 order by o.ord) from (select f.read_rating, f.status, ${readingOrdinalSql("f")} as ord from rr f where f.work_id = w.id) o
          where o.status = 'finished') as reads
      from works w
      where (select count(*) from rr f where f.work_id = w.id and f.status = 'finished') >= 2
        and exists (select 1 from rr where rr.work_id = w.id and ${finishedIn(year)})
      order by (select count(*) from rr f where f.work_id = w.id and f.status = 'finished') desc, w.title limit 6`),
  ]);
  const [{ higher }] = await rows<{ higher: number }>(sql`with ${BASE}, ordered as (
      select rr.*, lag(rr.read_rating) over (partition by rr.work_id order by ${sql.raw("coalesce(rr.started_on, rr.finished_on) asc nulls first, rr.source_key asc nulls last, rr.created_at asc, rr.id asc")}) as before
      from rr where rr.status = 'finished')
    select count(*)::float8 as higher from ordered rr where ${finishedIn(year)} and rr.reread and rr.read_rating > rr.before`);
  // Every half star, so the chart never skips one
  const halves = Array.from({ length: 10 }, (_, i) => (i + 1) / 2).map((rating) => ({ rating, count: distribution.find((d) => d.rating === rating)?.count ?? 0 }));
  return { distribution: halves, reread, higherOnReread: higher };
}

/* ── 5. Length and pace ─────────────────────────────────────────────────── */

export const LENGTH_BUCKETS = [
  { label: "Under 150", min: 0, max: 149 },
  { label: "150 to 299", min: 150, max: 299 },
  { label: "300 to 499", min: 300, max: 499 },
  { label: "500 to 799", min: 500, max: 799 },
  { label: "800 or more", min: 800, max: 1_000_000 },
] as const;

export interface BookRef {
  workId: string;
  title: string;
  slug: string | null;
  value: number;
}

export interface LengthPaceStats {
  lengths: { label: string; count: number }[];
  longest: BookRef | null;
  shortest: BookRef | null;
  /** Days from start to finish, both dates at day precision */
  fastest: BookRef | null;
  slowest: BookRef | null;
  /** Pages an hour of timed sessions, by language and the session's format */
  pace: { language: string; format: string; pagesPerHour: number; hours: number }[];
}

export async function lengthAndPace(year: StatsYear): Promise<LengthPaceStats> {
  const [finished, pace] = await Promise.all([
    rows<{ workId: string; title: string; slug: string | null; pages: number | null; days: number | null }>(sql`with ${BASE}
      select w.id::text as "workId", w.title, w.slug, rr.total_pages::float8 as pages,
        case when rr.started_precision = 'day' and rr.finished_precision = 'day' then (rr.finished_on - rr.started_on)::float8 end as days
      from rr join works w on w.id = rr.work_id where ${finishedIn(year)}`),
    rows<{ language: string; format: string; pagesPerHour: number; hours: number }>(sql`with ${BASE}
      select coalesce(e.language, re.language, w.original_language, 'unknown') as language, ss.format,
        (sum(coalesce(cp.pages, 0)) / (sum(ss.duration_seconds)::float8 / 3600))::float8 as "pagesPerHour",
        (sum(ss.duration_seconds)::float8 / 3600) as hours
      from ss join rr on rr.id = ss.reading_id join works w on w.id = rr.work_id
        left join editions e on e.id = ss.edition_id left join editions re on re.id = rr.edition_id
        left join cp on cp.session_id = ss.id
      where ss.duration_seconds > 0 and ${dayIn(year, sql`ss.read_on`)}
      group by 1, 2 having sum(ss.duration_seconds) >= 1800 and sum(coalesce(cp.pages, 0)) > 0 order by hours desc`),
  ]);
  const withPages = finished.filter((f) => f.pages);
  const ref = (f: (typeof finished)[number] | undefined, value: number | null) =>
    f && value !== null ? { workId: f.workId, title: f.title, slug: f.slug, value } : null;
  const byPages = [...withPages].sort((a, b) => b.pages! - a.pages! || a.title.localeCompare(b.title));
  const timed = finished.filter((f) => f.days !== null).sort((a, b) => a.days! - b.days! || a.title.localeCompare(b.title));
  return {
    lengths: LENGTH_BUCKETS.map((b) => ({ label: b.label, count: withPages.filter((f) => f.pages! >= b.min && f.pages! <= b.max).length })),
    longest: ref(byPages[0], byPages[0]?.pages ?? null),
    shortest: ref(byPages.at(-1), byPages.at(-1)?.pages ?? null),
    fastest: ref(timed[0], timed[0]?.days ?? null),
    slowest: ref(timed.at(-1), timed.at(-1)?.days ?? null),
    pace,
  };
}

/* ── 6. Languages and translation ───────────────────────────────────────── */

export interface LanguageStats {
  /** Original languages of the books finished */
  languages: { language: string; count: number }[];
  /** Finished readings whose edition's language and the work's original language are both known */
  known: number;
  translated: number;
  /** The original language most read in translation */
  topSource: { language: string; count: number } | null;
  translators: { authorId: string; name: string; slug: string; count: number }[];
}

export async function languages(year: StatsYear): Promise<LanguageStats> {
  const [langs, share, translators] = await Promise.all([
    rows<{ language: string; count: number }>(sql`with ${BASE}
      select w.original_language as language, count(*)::float8 as count from rr join works w on w.id = rr.work_id
      where ${finishedIn(year)} and w.original_language is not null group by 1 order by 2 desc, 1`),
    rows<{ source: string; translated: boolean; count: number }>(sql`with ${BASE}
      select w.original_language as source, e.language <> w.original_language as translated, count(*)::float8 as count
      from rr join works w on w.id = rr.work_id join editions e on e.id = rr.edition_id
      where ${finishedIn(year)} and w.original_language is not null group by 1, 2`),
    rows<{ authorId: string; name: string; slug: string; count: number }>(sql`with ${BASE}
      select a.id::text as "authorId", a.name, a.slug, count(distinct rr.id)::float8 as count
      from rr join edition_contributors ec on ec.edition_id = rr.edition_id and ec.role = 'translator' join authors a on a.id = ec.author_id
      where ${finishedIn(year)} group by a.id, a.name, a.slug order by 4 desc, a.name limit 8`),
  ]);
  const translated = share.filter((s) => s.translated);
  const bySource = new Map<string, number>();
  for (const s of translated) bySource.set(s.source, (bySource.get(s.source) ?? 0) + s.count);
  const top = [...bySource].sort((a, b) => b[1] - a[1])[0];
  return {
    languages: langs,
    known: share.reduce((s, x) => s + x.count, 0),
    translated: translated.reduce((s, x) => s + x.count, 0),
    topSource: top ? { language: top[0], count: top[1] } : null,
    translators,
  };
}

/* ── 7. Authors ─────────────────────────────────────────────────────────── */

export interface AuthorStats {
  byBooks: { authorId: string; name: string; slug: string; books: number; pages: number }[];
  byPages: { authorId: string; name: string; slug: string; books: number; pages: number }[];
  /** A year: authors whose first finished book is in it */
  newAuthors: { authorId: string; name: string; slug: string }[];
  /** The country's full name and its alpha-2 code */
  countries: { country: string; code: string; authors: number }[];
  /** Distinct authors by recorded gender; null is "not recorded" */
  genders: { gender: string | null; authors: number }[];
}

/** A book's writers: its authors and co-authors, as everywhere else in the app */
const WRITER = sql.raw(`wa.role in (${WORK_AUTHOR_ROLES.map((r) => `'${r}'`).join(", ")})`);

export async function authorStats(year: StatsYear): Promise<AuthorStats> {
  const [read, newAuthors, countries, genders] = await Promise.all([
    rows<{ authorId: string; name: string; slug: string; books: number; pages: number }>(sql`with ${BASE}
      select a.id::text as "authorId", a.name, a.slug,
        count(distinct rr.id) filter (where ${finishedIn(year)})::float8 as books,
        coalesce(round(sum(cp.pages) filter (where ${dayIn(year, sql`cp.day`, sql`cp.day_precision`)})), 0)::float8 as pages
      from authors a join work_authors wa on wa.author_id = a.id and ${WRITER}
        join rr on rr.work_id = wa.work_id left join cp on cp.reading_id = rr.id
      group by a.id, a.name, a.slug`),
    year === null
      ? Promise.resolve([] as { authorId: string; name: string; slug: string }[])
      : rows<{ authorId: string; name: string; slug: string }>(sql`with ${BASE}
          select a.id::text as "authorId", a.name, a.slug from authors a
          join work_authors wa on wa.author_id = a.id and ${WRITER} join rr on rr.work_id = wa.work_id
          where rr.status = 'finished' and rr.finished_precision <> 'unknown'
          group by a.id, a.name, a.slug having extract(year from min(rr.finished_on)) = ${year} order by a.name`),
    rows<{ country: string; code: string; authors: number }>(sql`with ${BASE}
      select c.name as country, c.alpha_2 as code, count(distinct a.id)::float8 as authors from authors a
      join countries c on c.id = a.nationality_id join work_authors wa on wa.author_id = a.id and ${WRITER}
      join rr on rr.work_id = wa.work_id where ${finishedIn(year)} group by 1, 2 order by 3 desc, 1`),
    rows<{ gender: string | null; authors: number }>(sql`with ${BASE}
      select a.gender::text as gender, count(distinct a.id)::float8 as authors from authors a
      join work_authors wa on wa.author_id = a.id and ${WRITER} join rr on rr.work_id = wa.work_id
      where ${finishedIn(year)} group by 1 order by 2 desc`),
  ]);
  const top = (key: "books" | "pages") => read.filter((r) => r[key] > 0).sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name)).slice(0, 8);
  return { byBooks: top("books"), byPages: top("pages"), newAuthors, countries, genders };
}

/* ── 8. When the books were written ─────────────────────────────────────── */

export interface EraStats {
  centuries: { century: number; count: number }[];
  decades: { decade: number; count: number }[];
  movements: { name: string; count: number }[];
  workTypes: { name: string; count: number }[];
  categories: { name: string; count: number }[];
}

export async function eras(year: StatsYear): Promise<EraStats> {
  const finished = finishedIn(year);
  const [years, movements, types, categories] = await Promise.all([
    rows<{ year: number }>(sql`with ${BASE} select w.original_year::int as year from rr join works w on w.id = rr.work_id where ${finished} and w.original_year is not null`),
    rows<{ name: string; count: number }>(sql`with ${BASE}
      select m.name, count(distinct rr.id)::float8 as count from rr join work_literary_movements wm on wm.work_id = rr.work_id
      join literary_movements m on m.id = wm.literary_movement_id where ${finished} group by 1 order by 2 desc, 1 limit 10`),
    rows<{ name: string; count: number }>(sql`with ${BASE}
      select t.name, count(*)::float8 as count from rr join works w on w.id = rr.work_id join work_types t on t.id = w.work_type_id
      where ${finished} group by 1 order by 2 desc, 1 limit 10`),
    rows<{ name: string; count: number }>(sql`with ${BASE}
      select c.name, count(distinct rr.id)::float8 as count from rr join work_categories wc on wc.work_id = rr.work_id
      join book_categories c on c.id = wc.category_id where ${finished} group by 1 order by 2 desc, 1 limit 10`),
  ]);
  const count = <K extends number>(key: (y: number) => K) => {
    const map = new Map<K, number>();
    for (const { year: y } of years) map.set(key(y), (map.get(key(y)) ?? 0) + 1);
    return [...map].sort((a, b) => a[0] - b[0]);
  };
  return {
    centuries: count((y) => Math.floor((y - 1) / 100) + 1).map(([century, n]) => ({ century, count: n })),
    decades: count((y) => Math.floor(y / 10) * 10).map(([decade, n]) => ({ decade, count: n })),
    movements,
    workTypes: types,
    categories,
  };
}

/* ── 9. Where and how ───────────────────────────────────────────────────── */

export interface WhereHowStats {
  /** Time and pages by format: each session under its own format; a finished reading without sessions under the reading's */
  formats: { format: string; minutes: number; pages: number; readings: number }[];
  /** Readings by their home (readings.location_id), never by a copy's place now */
  homes: { home: string | null; readings: number }[];
  /** Readings that name one of his copies, and those that do not (borrowed, library) */
  ownCopy: number;
  noCopy: number;
}

export async function whereAndHow(year: StatsYear): Promise<WhereHowStats> {
  const [formats, homes, copies] = await Promise.all([
    rows<{ format: string; minutes: number; pages: number; readings: number }>(sql`with ${BASE}
      select f.format, coalesce(sum(f.minutes), 0)::float8 as minutes, round(coalesce(sum(f.pages), 0))::float8 as pages, count(distinct f.reading_id)::float8 as readings
      from (
        select ss.format, ss.duration_seconds::float8 / 60 as minutes, coalesce(cp.pages, 0) as pages, ss.reading_id
        from ss left join cp on cp.session_id = ss.id where ${dayIn(year, sql`ss.read_on`)}
        union all
        select rr.format, 0, cp.pages, rr.id from cp join rr on rr.id = cp.reading_id
        where cp.session_id is null and ${dayIn(year, sql`cp.day`, sql`cp.day_precision`)}
      ) f group by 1 order by 2 desc, 3 desc`),
    rows<{ home: string | null; readings: number }>(sql`with ${BASE}
      select l.name as home, count(*)::float8 as readings from rr left join locations l on l.id = rr.location_id
      where ${activeIn(year)} group by 1 order by 2 desc`),
    rows<{ own: number; none: number }>(sql`with ${BASE}
      select count(*) filter (where rr.instance_id is not null)::float8 as own, count(*) filter (where rr.instance_id is null)::float8 as none
      from rr where ${activeIn(year)}`),
  ]);
  return { formats, homes, ownCopy: copies[0]?.own ?? 0, noCopy: copies[0]?.none ?? 0 };
}

/* ── 10. Shelf time ─────────────────────────────────────────────────────── */

export interface ShelfTimeStats {
  /** Books whose first reading started on or after their copy's acquisition, with day or month precision */
  counted: number;
  /** The average wait, in days */
  avgDays: number | null;
  longest: (BookRef & { acquired: string; started: string })[];
  readBeforeOwned: number;
  withoutAcquisitionDate: number;
  withoutPreciseStart: number;
}

export async function shelfTime(year: StatsYear): Promise<ShelfTimeStats> {
  const books = await rows<{ workId: string; title: string; slug: string | null; started: string | null; precision: string; acquired: string | null }>(sql`
    with first as (
      select distinct on (r.work_id) r.work_id, r.started_on, r.started_precision
      from readings r order by r.work_id, ${readingOrdinalSql("r")}
    )
    select w.id::text as "workId", w.title, w.slug, f.started_on::text as started, f.started_precision as precision,
      (select min(i.acquisition_date)::text from instances i join editions e on e.id = i.edition_id
        where e.work_id = w.id and i.status <> 'deaccessioned' and i.acquisition_date is not null) as acquired
    from first f join works w on w.id = f.work_id
    where w.kind = 'book' and ${year === null ? sql`true` : sql`f.started_on is not null and f.started_precision <> 'unknown' and extract(year from f.started_on) = ${year}`}`);
  const precise = books.filter((b) => b.started && (b.precision === "day" || b.precision === "month"));
  const dated = precise.filter((b) => b.acquired);
  const waits = dated
    .filter((b) => b.started! >= b.acquired!)
    .map((b) => ({ ...b, days: (Date.parse(b.started!) - Date.parse(b.acquired!)) / 86_400_000 }));
  return {
    counted: waits.length,
    avgDays: waits.length ? waits.reduce((s, w) => s + w.days, 0) / waits.length : null,
    longest: [...waits]
      .sort((a, b) => b.days - a.days || a.title.localeCompare(b.title))
      .slice(0, 5)
      .map((w) => ({ workId: w.workId, title: w.title, slug: w.slug, value: w.days, acquired: w.acquired!, started: w.started! })),
    readBeforeOwned: dated.filter((b) => b.started! < b.acquired!).length,
    withoutAcquisitionDate: precise.filter((b) => !b.acquired).length,
    withoutPreciseStart: books.length - precise.length,
  };
}

/* ── 11. The unread pile (always all time) ──────────────────────────────── */

export interface UnreadPile {
  books: number;
  pages: number;
  withoutPages: number;
  /** Pages a year over the last three years, from countedPagesSql */
  pagesPerYear: number;
  /** The pile at that pace, in years; null with no pace */
  years: number | null;
  /** Books with a copy at hand at each home (atHandCopySql) */
  atHand: { homeId: string; home: string; books: number }[];
}

/** The owned unread books: the library's reading=unread and holding=owned */
const PILE = sql`w.kind = 'book' and ${readingStateSql(sql`w.id`)} = 'unread' and ${ownedBookCondition(sql`w.id`)}`;

export async function unreadPile(today: string): Promise<UnreadPile> {
  const locations = await rows<{ id: string; name: string; type: string; isActive: boolean }>(
    sql`select id::text as id, name, type, is_active as "isActive" from locations order by name`,
  );
  const homes = homeOptions(locations);
  const [pile, pace, atHand] = await Promise.all([
    rows<{ books: number; pages: number; withoutPages: number }>(sql`
      select count(*)::float8 as books, coalesce(sum(p.pages), 0)::float8 as pages, count(*) filter (where p.pages is null)::float8 as "withoutPages"
      from (select w.id, coalesce(
          (select e.page_count from instances i join editions e on e.id = i.edition_id
            where e.work_id = w.id and i.status <> 'deaccessioned' order by i.created_at, i.id limit 1),
          (select max(e.page_count) from editions e where e.work_id = w.id)) as pages
        from works w where ${PILE}) p`),
    rows<{ pages: number }>(sql`with ${BASE}
      select coalesce(sum(cp.pages), 0)::float8 as pages from cp
      where cp.day is not null and cp.day > (${today}::date - interval '3 years') and cp.day <= ${today}::date`),
    homes.length
      ? rows<{ homeId: string; books: number }>(sql`
          select h.id::text as "homeId", count(w.id)::float8 as books
          from (select unnest(${`{${homes.map((h) => h.id).join(",")}}`}::uuid[]) as id) h
          left join works w on ${PILE} and exists (${atHandCopySql(sql`w.id`, sql`h.id`)})
          group by h.id`)
      : Promise.resolve([] as { homeId: string; books: number }[]),
  ]);
  const pagesPerYear = (pace[0]?.pages ?? 0) / 3;
  const { books, pages, withoutPages } = pile[0];
  return {
    books,
    pages,
    withoutPages,
    pagesPerYear,
    years: pagesPerYear > 0 ? pages / pagesPerYear : null,
    atHand: homes.map((h) => ({ homeId: h.id, home: h.name, books: atHand.find((a) => a.homeId === h.id)?.books ?? 0 })),
  };
}

/* ── 12. Recommenders ───────────────────────────────────────────────────── */

export interface RecommenderStat {
  recommenderId: string;
  name: string;
  /** Picks with a finished reading in the period */
  read: number;
  /** Of those, the ones with taste evidence (tasteRatingSql) */
  rated: number;
  avgRating: number | null;
  /** Rated 4 or more */
  liked: number;
}

export async function recommenderStats(year: StatsYear): Promise<RecommenderStat[]> {
  return rows<RecommenderStat>(sql`
    select r.id::text as "recommenderId", r.name, count(*)::float8 as read, count(t.rating)::float8 as rated,
      avg(t.rating)::float8 as "avgRating", count(*) filter (where t.rating >= 4)::float8 as liked
    from recommenders r join work_recommenders wr on wr.recommender_id = r.id
    join lateral (select ${tasteRatingSql(sql`wr.work_id`)} as rating) t on true
    where exists (select 1 from readings f where f.work_id = wr.work_id and ${finishedIn(year, "f")})
    group by r.id, r.name order by 3 desc, 2`);
}

/* ── 13. Abandoned ──────────────────────────────────────────────────────── */

export interface AbandonedStats {
  count: number;
  reasons: { reason: string | null; count: number }[];
  /** The middle share of the book he stops at, 0 to 100 */
  medianPercent: number | null;
}

export async function abandoned(year: StatsYear): Promise<AbandonedStats> {
  const inYear = year === null ? sql`true` : sql`r.finished_precision <> 'unknown' and extract(year from r.finished_on) = ${year}`;
  const [reasons, median] = await Promise.all([
    rows<{ reason: string | null; count: number }>(sql`select r.abandon_reason as reason, count(*)::float8 as count from readings r
      where r.status = 'abandoned' and ${inYear} group by 1 order by 2 desc`),
    rows<{ median: number | null }>(sql`select (percentile_cont(0.5) within group (order by r.current_percent))::float8 as median from readings r
      where r.status = 'abandoned' and r.current_percent is not null and ${inYear}`),
  ]);
  return { count: reasons.reduce((s, r) => s + r.count, 0), reasons, medianPercent: median[0]?.median ?? null };
}

/* ── 14. Insights' inputs ───────────────────────────────────────────────── */

export interface InsightGroup {
  count: number;
  avg: number | null;
}

export interface InsightInputs {
  short: InsightGroup;
  long: InsightGroup;
  translated: InsightGroup;
  original: InsightGroup;
  rereads: InsightGroup;
  firstReads: InsightGroup;
  ownCopy: InsightGroup;
  noCopy: InsightGroup;
  finished: number;
  started: number;
}

export async function insightInputs(year: StatsYear): Promise<InsightInputs> {
  const [row] = await rows<Record<string, number | null>>(sql`with ${BASE}, f as (
      select rr.*, e.language as edition_language, w.original_language from rr join works w on w.id = rr.work_id left join editions e on e.id = rr.edition_id
      where ${finishedIn(year)})
    select
      count(*) filter (where f.total_pages < 250 and f.read_rating is not null)::float8 as short_n, avg(f.read_rating) filter (where f.total_pages < 250)::float8 as short_avg,
      count(*) filter (where f.total_pages >= 250 and f.read_rating is not null)::float8 as long_n, avg(f.read_rating) filter (where f.total_pages >= 250)::float8 as long_avg,
      count(*) filter (where f.edition_language <> f.original_language and f.read_rating is not null)::float8 as tr_n,
      avg(f.read_rating) filter (where f.edition_language <> f.original_language)::float8 as tr_avg,
      count(*) filter (where f.edition_language = f.original_language and f.read_rating is not null)::float8 as or_n,
      avg(f.read_rating) filter (where f.edition_language = f.original_language)::float8 as or_avg,
      count(*) filter (where f.reread and f.read_rating is not null)::float8 as re_n, avg(f.read_rating) filter (where f.reread)::float8 as re_avg,
      count(*) filter (where not f.reread and f.read_rating is not null)::float8 as first_n, avg(f.read_rating) filter (where not f.reread)::float8 as first_avg,
      count(*) filter (where f.instance_id is not null and f.read_rating is not null)::float8 as own_n, avg(f.read_rating) filter (where f.instance_id is not null)::float8 as own_avg,
      count(*) filter (where f.instance_id is null and f.read_rating is not null)::float8 as none_n, avg(f.read_rating) filter (where f.instance_id is null)::float8 as none_avg,
      count(*)::float8 as finished,
      (select count(*)::float8 from rr where rr.status = 'abandoned' and ${year === null ? sql`true` : sql`rr.finished_precision <> 'unknown' and extract(year from rr.finished_on) = ${year}`}) as abandoned
    from f`);
  const g = (n: string, a: string): InsightGroup => ({ count: Number(row[n] ?? 0), avg: row[a] === null ? null : Number(row[a]) });
  const finished = Number(row.finished ?? 0);
  return {
    short: g("short_n", "short_avg"),
    long: g("long_n", "long_avg"),
    translated: g("tr_n", "tr_avg"),
    original: g("or_n", "or_avg"),
    rereads: g("re_n", "re_avg"),
    firstReads: g("first_n", "first_avg"),
    ownCopy: g("own_n", "own_avg"),
    noCopy: g("none_n", "none_avg"),
    finished,
    started: finished + Number(row.abandoned ?? 0),
  };
}

/* ── Years ──────────────────────────────────────────────────────────────── */

/** Years with any reading: a finish or stop with a known date, or a session; the newest first */
export async function statsYears(): Promise<number[]> {
  return (
    await rows<{ year: number }>(sql`select distinct y::int as year from (
        select extract(year from finished_on) as y from readings where finished_on is not null and finished_precision <> 'unknown'
        union select extract(year from started_on) from readings where started_on is not null and started_precision <> 'unknown'
        union select extract(year from read_on) from reading_sessions where not (source = 'timer' and ended_at is null)
      ) x order by 1 desc`)
  ).map((r) => r.year);
}

/** Years with finished books (a known finish), the newest first, with their counts */
export async function finishedYears(): Promise<{ year: number; books: number }[]> {
  return rows<{ year: number; books: number }>(sql`select extract(year from finished_on)::int as year, count(*)::float8 as books from readings
    where status = 'finished' and finished_precision <> 'unknown' and finished_on is not null group by 1 order by 1 desc`);
}

/* ── On this day ────────────────────────────────────────────────────────── */

export interface OnThisDay {
  /** The reading day it matched, YYYY-MM-DD */
  day: string;
  year: number;
  kind: "finished" | "started";
  workId: string;
  title: string;
  slug: string | null;
  rating: number | null;
}

/** Books finished or started on these days' calendar dates in earlier years, day precision only, three a day at most */
export async function onThisDay(days: string[]): Promise<OnThisDay[]> {
  if (!days.length) return [];
  return rows<OnThisDay>(sql`with ${BASE}, d as (select unnest(${`{${days.join(",")}}`}::date[]) as day),
    hits as (
      select d.day, extract(year from rr.finished_on)::int as year, 'finished' as kind, rr.work_id, rr.read_rating as rating, 0 as o
      from d join rr on rr.status = 'finished' and rr.finished_precision = 'day'
        and to_char(rr.finished_on, 'MM-DD') = to_char(d.day, 'MM-DD') and rr.finished_on < date_trunc('year', d.day)
      union all
      select d.day, extract(year from rr.started_on)::int, 'started', rr.work_id, null, 1
      from d join rr on rr.started_precision = 'day'
        and to_char(rr.started_on, 'MM-DD') = to_char(d.day, 'MM-DD') and rr.started_on < date_trunc('year', d.day)
    )
    select h.day::text as day, h.year, h.kind, h.work_id::text as "workId", w.title, w.slug, h.rating::float8 as rating from (
      select h.*, row_number() over (partition by h.day order by h.o, h.year desc, h.work_id) as n from hits h
    ) h join works w on w.id = h.work_id where h.n <= 3 order by h.day, h.o, h.year desc`);
}

/* ── Year in review ─────────────────────────────────────────────────────── */

export interface ReviewBook {
  workId: string;
  title: string;
  slug: string | null;
  cover: string | null;
  finishedOn: string;
  precision: string;
  rating: number | null;
  pages: number | null;
  reads: number;
}

export interface YearReview {
  numbers: YearNumbers;
  /** The year's finished books in finish order; month null when dated only by year */
  books: (ReviewBook & { month: number | null })[];
  first: ReviewBook | null;
  last: ReviewBook | null;
  longest: ReviewBook | null;
  highestRated: ReviewBook | null;
  mostReread: ReviewBook | null;
  busiestMonth: { month: number; books: number } | null;
  favouritePassage: { noteId: string; body: string; page: number | null; workId: string; title: string; slug: string | null } | null;
}

export async function yearReview(year: number): Promise<YearReview> {
  const [numbers, books, passage] = await Promise.all([
    yearNumbers(year),
    rows<ReviewBook & { month: number | null }>(sql`with ${BASE}
      select w.id::text as "workId", w.title, w.slug, rr.finished_on::text as "finishedOn", rr.finished_precision as precision,
        rr.read_rating::float8 as rating, rr.total_pages::float8 as pages,
        (select count(*)::int from readings f where f.work_id = w.id and f.status = 'finished') as reads,
        case when rr.finished_precision = 'year' then null else extract(month from rr.finished_on)::int end as month,
        coalesce((select coalesce(e.thumbnail_s3_key, e.cover_s3_key) from editions e where e.id = rr.edition_id),
          (select m.thumbnail_s3_key from media m where m.work_id = w.id and m.type = 'poster' and m.is_active order by m.sort_order limit 1),
          (select coalesce(e.thumbnail_s3_key, e.cover_s3_key) from editions e where e.work_id = w.id and coalesce(e.thumbnail_s3_key, e.cover_s3_key) is not null order by e.created_at limit 1)) as cover
      from rr join works w on w.id = rr.work_id
      where ${finishedIn(year)}
      order by rr.finished_on, (rr.finished_precision = 'day') desc, rr.created_at, rr.id`),
    rows<{ noteId: string; body: string; page: number | null; workId: string; title: string; slug: string | null }>(sql`
      select n.id::text as "noteId", n.body, n.page, w.id::text as "workId", w.title, w.slug
      from reading_notes n join works w on w.id = n.work_id
      where n.kind = 'quote' and n.is_favourite
        and (extract(year from n.created_at) = ${year}
          or exists (select 1 from readings r where r.work_id = n.work_id and r.status = 'finished' and r.finished_precision <> 'unknown' and extract(year from r.finished_on) = ${year}))
      order by exists (select 1 from readings r where r.work_id = n.work_id and r.status = 'finished' and extract(year from r.finished_on) = ${year}) desc, n.created_at desc
      limit 1`),
  ]);
  const dated = books.filter((b) => b.precision !== "year");
  const months = new Map<number, number>();
  for (const b of dated) months.set(b.month!, (months.get(b.month!) ?? 0) + 1);
  const busiest = [...months].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  const pick = (list: typeof books, by: (b: ReviewBook) => number | null) =>
    [...list].filter((b) => by(b) !== null).sort((a, b) => by(b)! - by(a)! || a.finishedOn.localeCompare(b.finishedOn))[0] ?? null;
  const reread = pick(books, (b) => (b.reads >= 2 ? b.reads : null));
  return {
    numbers,
    books,
    first: dated[0] ?? null,
    last: dated.at(-1) ?? null,
    longest: pick(books, (b) => b.pages),
    highestRated: pick(books, (b) => b.rating),
    mostReread: reread,
    busiestMonth: busiest ? { month: busiest[0], books: busiest[1] } : null,
    favouritePassage: passage[0] ?? null,
  };
}
