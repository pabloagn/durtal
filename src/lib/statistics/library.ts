import { sql, type SQL } from "drizzle-orm";
import { batchedRows } from "@/lib/db/read-batch";
import { WORK_AUTHOR_ROLES } from "@/lib/types";

/*
 * Library statistics (SLN-742): the books he owns, counted the way the
 * library counts them. A book is owned when it is accessioned and one of its
 * editions has a copy that is not deaccessioned (`ownedWorkCondition`,
 * SLN-886); copies count the same way. Aggregate queries only, never one per book, every number cast to
 * float8. Computed per request, never cached. Reading numbers stay on
 * /reading/stats (`src/lib/reading/stats.ts`).
 */

/** Every held copy of a book with its work, and the books those copies make owned */
const OWNED = sql`held as (
    select i.id, i.edition_id, i.location_id, i.format, i.acquisition_date, e.work_id
    from instances i join editions e on e.id = i.edition_id join works w on w.id = e.work_id
    where w.kind = 'book' and w.catalogue_status = 'accessioned' and i.status <> 'deaccessioned'),
  owned as (select distinct work_id as id from held),
  held_editions as (select distinct edition_id as id from held)`;

/** A book's writers: its authors and co-authors, as everywhere else in the app */
const WRITER = sql.raw(`wa.role in (${WORK_AUTHOR_ROLES.map((r) => `'${r}'`).join(", ")})`);

/** The picture a book's card shows: its active poster, else its first edition's cover */
const COVER = (work: SQL) => sql`coalesce(
    (select coalesce(m.thumbnail_s3_key, m.s3_key) from media m where m.work_id = ${work} and m.type = 'poster' and m.is_active order by m.id limit 1),
    (select coalesce(e.thumbnail_s3_key, e.cover_s3_key) from editions e where e.work_id = ${work} order by e.created_at, e.id limit 1))`;

async function rows<T>(query: SQL): Promise<T[]> {
  return batchedRows<T>(query);
}

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

export async function libraryNumbers(): Promise<LibraryNumbers> {
  const [row] = await rows<LibraryNumbers>(sql`with ${OWNED}
    select
      (select count(*)::float8 from owned) as books,
      (select count(*)::float8 from held_editions) as editions,
      (select count(*)::float8 from held) as copies,
      (select coalesce(sum(e.page_count), 0)::float8 from held_editions h join editions e on e.id = h.id) as pages,
      (select count(distinct wa.author_id)::float8 from work_authors wa join owned o on o.id = wa.work_id where ${WRITER}) as authors,
      (select count(distinct ep.publisher_id)::float8 from edition_publishers ep join held_editions h on h.id = ep.edition_id) as publishers,
      (select count(distinct w.original_language)::float8 from works w join owned o on o.id = w.id) as languages,
      (select count(distinct a.nationality_id)::float8 from authors a join work_authors wa on wa.author_id = a.id and ${WRITER}
        join owned o on o.id = wa.work_id) as countries`);
  return row;
}

/* ── When the books were written ────────────────────────────────────────── */

export interface YearCount {
  year: number;
  count: number;
}

/** Owned books by the year they were first published (the work's original year), earliest first */
export async function writtenYears(): Promise<{ years: YearCount[]; undated: number }> {
  const found = await rows<{ year: number | null; count: number }>(sql`with ${OWNED}
    select w.original_year::float8 as year, count(*)::float8 as count from works w join owned o on o.id = w.id
    group by 1 order by 1 nulls last`);
  return {
    years: found.filter((r): r is YearCount => r.year !== null),
    undated: found.find((r) => r.year === null)?.count ?? 0,
  };
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

/** The years with the most books, each with covers of its books, best rated first (Letterboxd's "1957, 11 films") */
export async function busiestYears(years: YearCount[], count = 3, per = 5): Promise<BusiestYear[]> {
  const top = [...years].sort((a, b) => b.count - a.count || b.year - a.year).slice(0, count);
  if (!top.length || top[0].count < 2) return [];
  const chosen = top.filter((y) => y.count >= 2);
  const covers = await rows<CoverBook & { year: number }>(sql`with ${OWNED}
    select year, "workId", slug, title, author, cover from (
      -- Covered books first, so a year shows its pictures before any blank, then the best rated
      select *, row_number() over (partition by year order by cover is null, rating desc nulls last, title, "workId") as position from (
        select w.original_year::float8 as year, w.id::text as "workId", w.slug, w.title, w.rating,
          (select a.name from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id and ${WRITER} order by wa.sort_order, a.name limit 1) as author,
          ${COVER(sql`w.id`)} as cover
        from works w join owned o on o.id = w.id
        where w.original_year in (${sql.join(chosen.map((y) => sql`${y.year}`), sql`, `)})
      ) books
    ) ranked where position <= ${per} order by year, position`);
  return chosen.map((y) => ({
    year: y.year,
    books: y.count,
    covers: covers.filter((c) => c.year === y.year).map(({ year: _year, ...book }) => book),
  }));
}

/** His best-rated books with a cover, for the head of the page */
export async function favouriteCovers(limit = 5): Promise<CoverBook[]> {
  return rows<CoverBook>(sql`with ${OWNED}
    select "workId", slug, title, author, cover from (
      select w.id::text as "workId", w.slug, w.title, w.rating, null::text as author, ${COVER(sql`w.id`)} as cover
      from works w join owned o on o.id = w.id where w.rating is not null) rated
    where cover is not null order by rating desc, title, "workId" limit ${limit}`);
}

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

export async function rankings(limit = 10): Promise<Rankings> {
  const [languages, countries, categories, authors, publishers] = await Promise.all([
    rows<Ranked>(sql`with ${OWNED}
      select w.original_language as key, w.original_language as name, count(*)::float8 as count
      from works w join owned o on o.id = w.id where w.original_language is not null
      group by 1 order by 3 desc, 1 limit ${limit}`),
    rows<Ranked>(sql`with ${OWNED}
      select c.alpha_2 as key, c.name, count(distinct o.id)::float8 as count
      from owned o join work_authors wa on wa.work_id = o.id and ${WRITER} join authors a on a.id = wa.author_id
        join countries c on c.id = a.nationality_id
      group by 1, 2 order by 3 desc, 2 limit ${limit}`),
    rows<Ranked>(sql`with ${OWNED}
      select c.id::text as key, c.name, count(distinct o.id)::float8 as count
      from owned o join work_categories wc on wc.work_id = o.id join book_categories c on c.id = wc.category_id
      group by 1, 2 order by 3 desc, 2 limit ${limit}`),
    rows<Ranked>(sql`with ${OWNED}
      select a.id::text as key, a.name, a.slug, count(distinct o.id)::float8 as count
      from owned o join work_authors wa on wa.work_id = o.id and ${WRITER} join authors a on a.id = wa.author_id
      group by 1, 2, 3 order by 4 desc, 2 limit ${limit}`),
    rows<Ranked>(sql`with ${OWNED}
      select p.id::text as key, p.name, p.slug, count(distinct h.id)::float8 as count
      from held_editions h join edition_publishers ep on ep.edition_id = h.id join publishing_houses p on p.id = ep.publisher_id
      group by 1, 2, 3 order by 4 desc, 2 limit ${limit}`),
  ]);
  return { languages, countries, categories, authors, publishers };
}

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

export async function breakdown(): Promise<Breakdown> {
  const digital = sql.raw(DIGITAL_FORMATS.map((f) => `'${f}'`).join(", "));
  const [row] = await rows<Breakdown>(sql`with ${OWNED}, books as (
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
      (select count(*)::float8 from held where format is null or format not in (${digital})) as print,
      (select count(*)::float8 from held where format in (${digital})) as digital`);
  return row;
}

/** Owned books by rating, in the half steps from 0.5 to 5 */
export async function ratingSpread(): Promise<{ rating: number; count: number }[]> {
  const found = await rows<{ rating: number; count: number }>(sql`with ${OWNED}
    select round(w.rating * 2)::float8 / 2 as rating, count(*)::float8 as count from works w join owned o on o.id = w.id
    where w.rating is not null group by 1`);
  return Array.from({ length: 10 }, (_, i) => {
    const rating = (i + 1) / 2;
    return { rating, count: found.find((f) => f.rating === rating)?.count ?? 0 };
  });
}

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

export async function copyStats(): Promise<CopyStats> {
  const [formats, places, acquired] = await Promise.all([
    rows<{ format: string | null; count: number }>(sql`with ${OWNED}
      select format, count(*)::float8 as count from held group by 1 order by 2 desc, 1`),
    rows<{ id: string; name: string; count: number }>(sql`with ${OWNED}
      select l.id::text as id, l.name, count(*)::float8 as count from held h join locations l on l.id = h.location_id
      group by 1, 2 order by 3 desc, 2`),
    rows<{ year: number | null; count: number }>(sql`with ${OWNED}
      select extract(year from acquisition_date)::float8 as year, count(*)::float8 as count from held group by 1 order by 1 nulls last`),
  ]);
  return {
    formats,
    places,
    acquired: acquired.filter((a): a is YearCount => a.year !== null),
    undated: acquired.find((a) => a.year === null)?.count ?? 0,
  };
}

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

export async function extremes(): Promise<Extremes> {
  const pick = (value: SQL, order: SQL, where: SQL, join = sql``) => sql`(select row_to_json(x) from (
      select w.id::text as "workId", w.slug, w.title, ${value} as value,
        (select a.name from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id and ${WRITER} order by wa.sort_order, a.name limit 1) as author,
        ${COVER(sql`w.id`)} as cover
      from works w join owned o on o.id = w.id ${join} where ${where} order by ${order}, w.title, w.id limit 1) x)`;
  const pageJoin = sql`join pages p on p.work_id = w.id`;
  const [row] = await rows<{ [K in keyof Extremes]: (Omit<Extreme, "value"> & { value: number | string }) | null }>(sql`with ${OWNED},
    pages as (select e.work_id, max(e.page_count) as pages
      from held_editions h join editions e on e.id = h.id group by e.work_id)
    select
      ${pick(sql`w.original_year`, sql`w.original_year asc`, sql`w.original_year is not null`)} as oldest,
      ${pick(sql`w.original_year`, sql`w.original_year desc`, sql`w.original_year is not null`)} as newest,
      ${pick(sql`p.pages`, sql`p.pages desc`, sql`p.pages > 0`, pageJoin)} as longest,
      ${pick(sql`p.pages`, sql`p.pages asc`, sql`p.pages > 0`, pageJoin)} as shortest`);
  const parse = (x: (Omit<Extreme, "value"> & { value: number | string }) | null): Extreme | null => (x ? { ...x, value: Number(x.value) } : null);
  return { oldest: parse(row.oldest), newest: parse(row.newest), longest: parse(row.longest), shortest: parse(row.shortest) };
}
