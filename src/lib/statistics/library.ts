import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { WORK_AUTHOR_ROLES } from "@/lib/types";
import { workCoverSql } from "@/lib/library/filter-conditions";

/*
 * Library statistics (SLN-742): the books he owns, counted the way the
 * library counts them. A book is owned when it is accessioned and one of its
 * editions has a copy that is not deaccessioned (`ownedWorkCondition`,
 * SLN-886); copies count the same way. Aggregate queries only, never one per book, every number cast to
 * float8. Computed per request, never cached. Reading numbers stay on
 * /reading/stats (`src/lib/reading/stats.ts`).
 *
 * A page reads all its sections in one statement (`libraryStatistics`), so
 * the held copies are found once, not once per section (SLN-1315). Each
 * section is one JSON value of that statement's one row.
 */

/** A book's writers: its authors and co-authors, as everywhere else in the app */
const WRITER = sql.raw(`wa.role in (${WORK_AUTHOR_ROLES.map((r) => `'${r}'`).join(", ")})`);

/**
 * Every held copy of a book with its work, the books those copies make owned,
 * those books by the year they were written, and each one's writers
 */
const OWNED = sql`held as (
    select i.id, i.edition_id, i.location_id, i.format, i.acquisition_date, e.work_id
    from instances i join editions e on e.id = i.edition_id join works w on w.id = e.work_id
    where w.kind = 'book' and w.catalogue_status = 'accessioned' and i.status <> 'deaccessioned'),
  owned as (select distinct work_id as id from held),
  held_editions as (select distinct edition_id as id from held),
  written as (select w.original_year as year, count(*)::float8 as count from works w join owned o on o.id = w.id group by 1),
  writers as (select distinct wa.work_id, wa.author_id from work_authors wa join owned o on o.id = wa.work_id where ${WRITER})`;

/** The picture a book's card shows (SLN-1286) */
const COVER = (work: SQL) => workCoverSql(work);

/** Rows as one JSON array in `order`, the same order as the query's own, over its columns as `x` */
const list = (query: SQL, order: SQL) => sql`(select coalesce(json_agg(x order by ${order}), '[]'::json) from (${query}) x)`;

/** A query's one row as a JSON object */
const one = (query: SQL) => sql`(select row_to_json(x) from (${query}) x)`;

/** The first writer of the book `w` */
const FIRST_WRITER = sql`(select a.name from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id and ${WRITER} order by wa.sort_order, a.name limit 1)`;


/* ── Numbers ────────────────────────────────────────────────────────────── */

export interface LibraryNumbers {
  books: number;
  editions: number;
  copies: number;
  /** The page counts of the editions he holds; editions without one add nothing */
  pages: number;
  authors: number;
  publishers: number;
  /** The languages his books were first written in */
  languages: number;
  /** His writers' recorded nationalities */
  countries: number;
}

const numbers = sql`select
    (select count(*)::float8 from owned) as books,
    (select count(*)::float8 from held_editions) as editions,
    (select count(*)::float8 from held) as copies,
    (select coalesce(sum(e.page_count), 0)::float8 from held_editions h join editions e on e.id = h.id) as pages,
    (select count(distinct author_id)::float8 from writers) as authors,
    (select count(distinct ep.publisher_id)::float8 from edition_publishers ep join held_editions h on h.id = ep.edition_id) as publishers,
    (select count(distinct w.original_language)::float8 from works w join owned o on o.id = w.id) as languages,
    (select count(distinct a.nationality_id)::float8 from writers wr join authors a on a.id = wr.author_id) as countries`;

/* ── When the books were written ────────────────────────────────────────── */

export interface YearCount {
  year: number;
  count: number;
}

/** A book on a shelf of covers */
export interface CoverBook {
  workId: string;
  slug: string | null;
  title: string;
  author: string | null;
  /** The S3 key of the picture its card shows, if any */
  cover: string | null;
}

export interface BusiestYear {
  year: number;
  books: number;
  covers: CoverBook[];
}

/** How many books a year shows as covers */
const COVERS_A_YEAR = 5;

/**
 * The years with the most books (at least two), most first, each with covers
 * of its books, best rated first (Letterboxd's "1957, 11 films")
 */
const busiest = (count: number) => sql`with chosen as (
      select year, count from (select year, count from written where year is not null order by count desc, year desc limit ${count}) top
      where count >= 2),
    ranked as (
      -- Covered books first, so a year shows its pictures before any blank, then the best rated
      select *, row_number() over (partition by year order by cover is null, rating desc nulls last, title, "workId") as position from (
        select w.original_year as year, w.id::text as "workId", w.slug, w.title, w.rating, ${FIRST_WRITER} as author, ${COVER(sql`w.id`)} as cover
        from works w join owned o on o.id = w.id
        where w.original_year in (select year from chosen)) books)
    select c.year, c.count as books, (
        select coalesce(json_agg(json_build_object('workId', r."workId", 'slug', r.slug, 'title', r.title, 'author', r.author, 'cover', r.cover)
          order by r.position), '[]'::json)
        from ranked r where r.year = c.year and r.position <= ${COVERS_A_YEAR}) as covers
    from chosen c`;

/** His best-rated books with a cover, for the head of the page; a cover is looked up only until five are found */
const favourites = sql`select w.id::text as "workId", w.slug, w.title, w.rating, null::text as author, c.cover
  from (select w.* from works w join owned o on o.id = w.id where w.rating is not null order by w.rating desc, w.title, w.id) w
    cross join lateral (select ${COVER(sql`w.id`)} as cover) c
  where c.cover is not null order by w.rating desc, w.title, w.id limit 5`;

/* ── Languages, countries and categories ────────────────────────────────── */

export interface Ranked {
  /** A language code, a country's alpha-2 code, a category's or a person's id */
  key: string;
  name: string;
  /** For a person or a house, the slug of their page */
  slug?: string | null;
  count: number;
}

export interface Rankings {
  /** The languages the books were first written in */
  languages: Ranked[];
  /** The writers' nationalities, by the books of theirs he owns */
  countries: Ranked[];
  categories: Ranked[];
  /** Writers by the books of theirs he owns */
  authors: Ranked[];
  /** Publishing houses by the editions of theirs he holds */
  publishers: Ranked[];
}

/** How many of each a ranking lists */
const RANKED = 10;

/** Most first; a tie by name, then by key */
const byCount = sql`x.count desc, x.name, x.key`;

const rankings = sql`select
    ${list(
      sql`select w.original_language as key, w.original_language as name, count(*)::float8 as count
        from works w join owned o on o.id = w.id where w.original_language is not null
        group by 1 order by 3 desc, 1 limit ${RANKED}`,
      sql`x.count desc, x.key`,
    )} as languages,
    ${list(
      sql`select c.alpha_2 as key, c.name, count(distinct wr.work_id)::float8 as count
        from writers wr join authors a on a.id = wr.author_id join countries c on c.id = a.nationality_id
        group by 1, 2 order by 3 desc, 2, 1 limit ${RANKED}`,
      byCount,
    )} as countries,
    ${list(
      sql`select c.id::text as key, c.name, n.count from (
          select wc.category_id, count(distinct wc.work_id)::float8 as count from work_categories wc join owned o on o.id = wc.work_id group by 1) n
        join book_categories c on c.id = n.category_id
        order by 3 desc, 2, 1 limit ${RANKED}`,
      byCount,
    )} as categories,
    ${list(
      sql`select a.id::text as key, a.name, a.slug, n.count from (
          select author_id, count(*)::float8 as count from writers group by 1) n
        join authors a on a.id = n.author_id
        order by 4 desc, 2, 1 limit ${RANKED}`,
      byCount,
    )} as authors,
    ${list(
      sql`select p.id::text as key, p.name, p.slug, n.count from (
          select ep.publisher_id, count(distinct ep.edition_id)::float8 as count from edition_publishers ep join held_editions h on h.id = ep.edition_id group by 1) n
        join publishing_houses p on p.id = n.publisher_id
        order by 4 desc, 2, 1 limit ${RANKED}`,
      byCount,
    )} as publishers`;

/* ── Breakdown ──────────────────────────────────────────────────────────── */

export interface Breakdown {
  /** Owned books with a finished reading, and the rest */
  read: number;
  unread: number;
  /** Owned books he has rated, and the rest */
  rated: number;
  unrated: number;
  /** Held editions in another language than the book's own, and those in it; editions missing either language are left out */
  translated: number;
  original: number;
  /** Copies on paper (and copies of no recorded format), and digital ones */
  print: number;
  digital: number;
}

/** The formats of a digital copy */
export const DIGITAL_FORMATS = ["ebook", "epub", "pdf", "audiobook"] as const;

const DIGITAL = sql.raw(DIGITAL_FORMATS.map((f) => `'${f}'`).join(", "));

const breakdown = sql`with books as (
      select o.id, w.rating, exists (select 1 from readings r where r.work_id = o.id and r.status = 'finished') as read
      from owned o join works w on w.id = o.id),
    langs as (
      select e.language <> w.original_language as translated
      from held_editions h join editions e on e.id = h.id join works w on w.id = e.work_id
      where e.language is not null and w.original_language is not null)
    select
      (select count(*)::float8 from books where read) as read,
      (select count(*)::float8 from books where not read) as unread,
      (select count(*)::float8 from books where rating is not null) as rated,
      (select count(*)::float8 from books where rating is null) as unrated,
      (select count(*)::float8 from langs where translated) as translated,
      (select count(*)::float8 from langs where not translated) as original,
      (select count(*)::float8 from held where format is null or format not in (${DIGITAL})) as print,
      (select count(*)::float8 from held where format in (${DIGITAL})) as digital`;

/** Owned books by rating, in the half steps from 0.5 to 5 */
const ratings = sql`select round(w.rating * 2)::float8 / 2 as rating, count(*)::float8 as count from works w join owned o on o.id = w.id
  where w.rating is not null group by 1`;

/* ── Copies ─────────────────────────────────────────────────────────────── */

export interface CopyStats {
  /** Copies by format; null is "not recorded" */
  formats: { format: string | null; count: number }[];
  /** Copies by place */
  places: { id: string; name: string; count: number }[];
  /** Copies by the year they came, earliest first */
  acquired: YearCount[];
  /** Copies with no acquisition date */
  undated: number;
}

const copies = sql`select
    ${list(sql`select format, count(*)::float8 as count from held group by 1 order by 2 desc, 1`, sql`x.count desc, x.format`)} as formats,
    ${list(
      sql`select l.id::text as id, l.name, count(*)::float8 as count from held h join locations l on l.id = h.location_id
        group by 1, 2 order by 3 desc, 2, 1`,
      sql`x.count desc, x.name, x.id`,
    )} as places,
    ${list(
      sql`select extract(year from acquisition_date)::float8 as year, count(*)::float8 as count from held group by 1 order by 1 nulls last`,
      sql`x.year nulls last`,
    )} as acquired`;

/* ── Extremes ───────────────────────────────────────────────────────────── */

export interface Extreme extends CoverBook {
  /** The year, or the page count */
  value: number;
}

export interface Extremes {
  oldest: Extreme | null;
  newest: Extreme | null;
  longest: Extreme | null;
  shortest: Extreme | null;
}

/** The book in `from` where `where` holds, the first by title on a tie */
const pick = (value: SQL, from: SQL, where: SQL) => sql`(select row_to_json(x) from (
    select w.id::text as "workId", w.slug, w.title, ${value} as value, ${FIRST_WRITER} as author, ${COVER(sql`w.id`)} as cover
    ${from} where ${where} order by w.title, w.id limit 1) x)`;
const ownedWorks = sql`from works w join owned o on o.id = w.id`;
const pagedWorks = sql`from pages p join works w on w.id = p.work_id`;

/** Each held book's longest held edition */
const extremes = sql`with pages as (select e.work_id, max(e.page_count) as pages
      from held_editions h join editions e on e.id = h.id group by e.work_id)
    select
      ${pick(sql`w.original_year`, ownedWorks, sql`w.original_year = (select min(year) from written)`)} as oldest,
      ${pick(sql`w.original_year`, ownedWorks, sql`w.original_year = (select max(year) from written)`)} as newest,
      ${pick(sql`p.pages`, pagedWorks, sql`p.pages = (select max(pages) from pages where pages > 0)`)} as longest,
      ${pick(sql`p.pages`, pagedWorks, sql`p.pages = (select min(pages) from pages where pages > 0)`)} as shortest`;

/* ── One statement ──────────────────────────────────────────────────────── */

export interface LibraryStatistics {
  numbers: LibraryNumbers;
  /** Owned books by the year they were first published (the work's original year), earliest first, and those with none */
  written: { years: YearCount[]; undated: number };
  /** The years with the most books (`busiest` of them, three unless asked) */
  busiest: BusiestYear[];
  favourites: CoverBook[];
  rankings: Rankings;
  breakdown: Breakdown;
  ratings: { rating: number; count: number }[];
  copies: CopyStats;
  extremes: Extremes;
}

export type StatisticsPart = keyof LibraryStatistics;

type Json = Record<string, unknown>;
type ExtremeJson = (Omit<Extreme, "value"> & { value: number | string }) | null;

/** Each part as one JSON value, and how it is read back */
const PARTS: { [P in StatisticsPart]: (options: { busiest: number }) => { sql: SQL; read: (value: never) => LibraryStatistics[P] } } = {
  numbers: () => ({ sql: one(numbers), read: (value: LibraryNumbers) => value }),
  written: () => ({
    sql: list(sql`select year, count from written order by year nulls last`, sql`x.year nulls last`),
    read: (found: { year: number | null; count: number }[]) => ({
      years: found.filter((r): r is YearCount => r.year !== null),
      undated: found.find((r) => r.year === null)?.count ?? 0,
    }),
  }),
  busiest: ({ busiest: count }) => ({
    sql: list(busiest(count), sql`x.books desc, x.year desc`),
    read: (years: BusiestYear[]) => years,
  }),
  favourites: () => ({
    sql: list(favourites, sql`x.rating desc, x.title, x."workId"`),
    read: (books: (CoverBook & { rating: number })[]) => books.map(({ rating: _rating, ...book }) => book),
  }),
  rankings: () => ({ sql: one(rankings), read: (value: Rankings) => value }),
  breakdown: () => ({ sql: one(breakdown), read: (value: Breakdown) => value }),
  ratings: () => ({
    sql: list(ratings, sql`x.rating`),
    read: (found: { rating: number; count: number }[]) =>
      Array.from({ length: 10 }, (_, i) => {
        const rating = (i + 1) / 2;
        return { rating, count: found.find((f) => f.rating === rating)?.count ?? 0 };
      }),
  }),
  copies: () => ({
    sql: one(copies),
    read: ({ formats, places, acquired }: Omit<CopyStats, "acquired" | "undated"> & { acquired: { year: number | null; count: number }[] }) => ({
      formats,
      places,
      acquired: acquired.filter((a): a is YearCount => a.year !== null),
      undated: acquired.find((a) => a.year === null)?.count ?? 0,
    }),
  }),
  extremes: () => ({
    sql: one(extremes),
    read: (row: { [K in keyof Extremes]: ExtremeJson }) => {
      const parse = (x: ExtremeJson): Extreme | null => (x ? { ...x, value: Number(x.value) } : null);
      return { oldest: parse(row.oldest), newest: parse(row.newest), longest: parse(row.longest), shortest: parse(row.shortest) };
    },
  }),
};

/**
 * The parts of the library statistics a page shows, read in one statement:
 * the held copies, the owned books and the years they were written are
 * found once for all of them (SLN-1315). `busiest` is how many busiest years
 * to show.
 */
export async function libraryStatistics<P extends StatisticsPart>(parts: readonly P[], options: { busiest?: number } = {}): Promise<Pick<LibraryStatistics, P>> {
  const chosen = parts.map((part) => [part, PARTS[part]({ busiest: options.busiest ?? 3 })] as const);
  // Its own request, not one of a batch (`batchedRows`), whose other reads would wait for it
  const [row] = resultRows<Json>(
    await db.execute(sql`with ${OWNED} select ${sql.join(
      chosen.map(([part, read]) => sql`${read.sql} as ${sql.identifier(part)}`),
      sql`, `,
    )}`),
  );
  return Object.fromEntries(chosen.map(([part, read]) => [part, (read.read as (value: unknown) => unknown)(row[part])])) as Pick<LibraryStatistics, P>;
}
