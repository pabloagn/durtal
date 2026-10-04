/**
 * The books of a publishing house, as a catalogue: one card per work, with
 * the cover of this house's edition (not the work's default cover), searched,
 * filtered, sorted and paged on the server. A house's books include those of
 * its imprints (`publisher_family`).
 */
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { acquisitionTargets, media, publishingHouses as houses, works } from "@/lib/db/schema";
import { targetState } from "./conditions";
import { resultRows } from "@/lib/harmonization/store";
import { parsePagination, type ListSearchParams, toSearchParams } from "@/lib/utils/pagination";
import { parseMarks, type WorkMarkKey } from "@/lib/constants/marks";

export const PUBLISHER_BOOK_STATES = ["owned", "wanted", "on_order"] as const;
export type PublisherBookState = (typeof PUBLISHER_BOOK_STATES)[number];

export const PUBLISHER_BOOK_SORTS = ["title", "author", "year", "recent"] as const;
export type PublisherBookSort = (typeof PUBLISHER_BOOK_SORTS)[number];

const DEFAULT_ORDER: Record<PublisherBookSort, "asc" | "desc"> = {
  title: "asc",
  author: "asc",
  year: "desc",
  recent: "desc",
};

export interface PublisherBookQuery {
  q?: string;
  state: PublisherBookState[];
  marks: WorkMarkKey[];
  languages: string[];
  bindings: string[];
  yearMin?: number;
  yearMax?: number;
  authors: string[];
  imprints: string[];
  sort: PublisherBookSort;
  order: "asc" | "desc";
  page: number;
  perPage: number;
  offset: number;
}

const list = (value: string | null) => value?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];
const uuids = (value: string | null) => list(value).filter((v) => z.uuid().safeParse(v).success);
const year = (value: string | null) => {
  const n = Number(value);
  return value && Number.isInteger(n) && n > -5000 && n < 3000 ? n : undefined;
};

/** The page's URL, read into a query. Unknown values are dropped. */
export function parsePublisherBookQuery(raw: ListSearchParams): PublisherBookQuery {
  const params = toSearchParams(raw);
  // The old tabs (?filter=owned) still open the same view
  const legacy = params.get("filter");
  const state = list(params.get("state") ?? (legacy && legacy !== "all" ? legacy : null)).filter(
    (s): s is PublisherBookState => (PUBLISHER_BOOK_STATES as readonly string[]).includes(s),
  );
  const sortParam = params.get("sort");
  const sort = (PUBLISHER_BOOK_SORTS as readonly string[]).includes(sortParam ?? "")
    ? (sortParam as PublisherBookSort)
    : "title";
  const orderParam = params.get("order");
  const { page, perPage, offset } = parsePagination(raw, { defaultPerPage: 24 });
  return {
    q: params.get("q")?.trim().slice(0, 200) || undefined,
    state,
    marks: parseMarks(params.get("mark") ?? ""),
    languages: list(params.get("language")).filter((l) => /^[a-z]{2,3}$/i.test(l)),
    bindings: list(params.get("binding")).slice(0, 20),
    yearMin: year(params.get("yearMin")),
    yearMax: year(params.get("yearMax")),
    authors: uuids(params.get("author")),
    imprints: uuids(params.get("imprint")),
    sort,
    order: orderParam === "asc" || orderParam === "desc" ? orderParam : DEFAULT_ORDER[sort],
    page,
    perPage,
    offset,
  };
}

export interface PublisherBook {
  workId: string;
  slug: string;
  title: string;
  authorName: string;
  authorNames: string[];
  coverUrl: string | null;
  coverCrop: { cropX: number; cropY: number; cropZoom: number } | null;
  coverTone: string | null;
  publicationYear: number | null;
  language: string | null;
  instanceCount: number;
  rating: number | null;
  catalogueStatus: string | null;
  isRare: boolean;
  huntAssessedOn: string | null;
  isPoison: boolean;
  acquisitionPriority: string | null;
  primaryEditionId: string;
}

export interface PublisherBookFacets {
  languages: { value: string; count: number }[];
  bindings: { value: string; count: number }[];
  /** The earliest and latest edition year, when any edition has one */
  years: { min: number | null; max: number | null };
  authors: { id: string; name: string; count: number }[];
  imprints: { id: string; name: string; count: number }[];
}

const s3Url = (key: string | null) => (key ? `/api/s3/read?key=${encodeURIComponent(key)}` : null);

/** Per edition of the family: owned, on order, wanted (as the old tabs had them) */
function editionState(edition: SQL) {
  return {
    owned: sql`exists (select 1 from instances i where i.edition_id = ${edition} and i.status <> 'deaccessioned')`,
    onOrder: sql`exists (select 1 from orders o where o.edition_id = ${edition} and o.status not in ('cancelled', 'returned', 'delivered', 'received', 'purchased'))`,
    // The same rule as the house's old tabs (getPublisherCatalogue)
    wanted: sql`(exists (select 1 from acquisition_targets where work_id = e.work_id and target_accepts_edition(id, ${edition}) and (${targetState}) = 'wanted')
      or (w.catalogue_status in ('wanted', 'shortlisted')
        and not exists (select 1 from acquisition_targets t where t.work_id = e.work_id and not t.is_cancelled)))`,
  };
}

/**
 * One page of the house's books and the total, with the filters applied,
 * plus the values each filter can take (from all of the house's books).
 */
export async function getPublisherBooks(publisherId: string, query: PublisherBookQuery) {
  z.uuid().parse(publisherId);
  const family = sql`(select publisher_family(${publisherId}::uuid))`;
  const state = editionState(sql`e.id`);
  // Every edition of a book from the house or its imprints
  const base = sql`from editions e
    join works w on w.id = e.work_id and w.kind = 'book'
    where exists (select 1 from edition_publishers ep where ep.edition_id = e.id and ep.publisher_id in ${family})`;

  const filters: SQL[] = [];
  if (query.state.length)
    filters.push(sql`(${sql.join(
      query.state.map((s) => (s === "owned" ? state.owned : s === "on_order" ? state.onOrder : state.wanted)),
      sql` or `,
    )})`);
  if (query.marks.includes("rare")) filters.push(sql`w.is_rare`);
  if (query.marks.includes("poison")) filters.push(sql`w.is_poison`);
  if (query.languages.length) filters.push(sql`e.language in ${query.languages}`);
  if (query.bindings.length) filters.push(sql`e.binding in ${query.bindings}`);
  if (query.yearMin !== undefined) filters.push(sql`e.publication_year >= ${query.yearMin}`);
  if (query.yearMax !== undefined) filters.push(sql`e.publication_year <= ${query.yearMax}`);
  if (query.authors.length)
    filters.push(sql`exists (select 1 from work_authors wa where wa.work_id = w.id and wa.author_id in (${sql.join(query.authors.map((a) => sql`${a}::uuid`), sql`, `)}))`);
  if (query.imprints.length)
    filters.push(sql`exists (select 1 from edition_publishers ep where ep.edition_id = e.id and ep.publisher_id in (${sql.join(query.imprints.map((i) => sql`${i}::uuid`), sql`, `)}))`);
  if (query.q) {
    const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const digits = query.q.replace(/[^0-9xX]/g, "");
    filters.push(sql`(w.title ilike ${like} or e.title ilike ${like}
      or exists (select 1 from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id and a.name ilike ${like})
      ${digits.length >= 10 ? sql`or e.isbn_13 = ${digits} or e.isbn_10 = ${digits}` : sql``})`);
  }
  const where = filters.length ? sql` and ${sql.join(filters, sql` and `)}` : sql``;

  const direction = query.order === "asc" ? sql`asc` : sql`desc`;
  const orderBy = {
    title: sql`lower(title) ${direction}, work_id`,
    author: sql`lower(author_sort) ${direction} nulls last, lower(title), work_id`,
    year: sql`year ${direction} nulls last, lower(title), work_id`,
    recent: sql`created_at ${direction}, work_id`,
  }[query.sort];

  // One row per work: its best edition from the house (owned first, then one
  // with a cover, then the earliest)
  const picked = sql`select distinct on (e.work_id)
      e.work_id, e.id as edition_id, w.title, w.created_at,
      e.publication_year as year,
      (select coalesce(a.sort_name, a.name) from work_authors wa join authors a on a.id = wa.author_id
        where wa.work_id = w.id order by wa.sort_order limit 1) as author_sort
    ${base}${where}
    order by e.work_id, ${state.owned} desc, (e.thumbnail_s3_key is not null or e.cover_s3_key is not null) desc,
      e.publication_year nulls last, e.id`;

  const [pageRows, [{ total }]] = await Promise.all([
    db.execute(sql`select * from (${picked}) p order by ${orderBy} limit ${query.perPage} offset ${query.offset}`).then((r) =>
      resultRows<{ work_id: string; edition_id: string }>(r),
    ),
    db.execute(sql`select count(*)::int as total from (${picked}) p`).then((r) => resultRows<{ total: number }>(r)),
  ]);

  const books = pageRows.length ? await cards(pageRows.map((r) => r.edition_id)) : [];
  const byEdition = new Map(books.map((b) => [b.primaryEditionId, b]));
  return {
    books: pageRows.map((r) => byEdition.get(r.edition_id)!).filter(Boolean),
    total,
  };
}

/** Card data for these editions, in no particular order */
async function cards(editionIds: string[]): Promise<PublisherBook[]> {
  const ids = sql.join(editionIds.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = resultRows<{
    edition_id: string;
    work_id: string;
    slug: string | null;
    title: string;
    authors: string[] | null;
    edition_cover: string | null;
    poster: { s3Key: string; thumbnailS3Key: string | null; cropX: number; cropY: number; cropZoom: number; tone: string | null } | null;
    year: number | null;
    language: string | null;
    copies: number;
    rating: number | null;
    catalogue_status: string | null;
    is_rare: boolean;
    hunt_assessed_on: string | null;
    is_poison: boolean;
    acquisition_priority: string | null;
  }>(
    await db.execute(sql`select e.id as edition_id, w.id as work_id, w.slug, w.title,
        (select array_agg(a.name order by wa.sort_order) from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id) as authors,
        coalesce(e.thumbnail_s3_key, e.cover_s3_key) as edition_cover,
        (select json_build_object('s3Key', m.s3_key, 'thumbnailS3Key', m.thumbnail_s3_key, 'cropX', m.crop_x, 'cropY', m.crop_y,
            'cropZoom', m.crop_zoom, 'tone', m.color_palette->'dominant'->>'hex')
          from media m where m.work_id = w.id and m.type = 'poster' and m.is_active order by m.created_at, m.id limit 1) as poster,
        e.publication_year as year, e.language,
        (select count(*)::int from instances i where i.edition_id = e.id and i.status <> 'deaccessioned') as copies,
        w.rating, w.catalogue_status, w.is_rare, w.hunt_assessed_on, w.is_poison, w.acquisition_priority
      from editions e join works w on w.id = e.work_id
      where e.id in (${ids})`),
  );
  return rows.map((r) => {
    // This house's edition cover first; the work's poster only when it has none
    const usePoster = !r.edition_cover && r.poster;
    return {
      workId: r.work_id,
      slug: r.slug ?? "",
      title: r.title,
      authorName: r.authors?.[0] ?? "Unknown",
      authorNames: r.authors ?? [],
      coverUrl: s3Url(r.edition_cover ?? (r.poster ? r.poster.thumbnailS3Key ?? r.poster.s3Key : null)),
      coverCrop: usePoster ? { cropX: r.poster!.cropX, cropY: r.poster!.cropY, cropZoom: r.poster!.cropZoom } : null,
      coverTone: r.poster?.tone ?? null,
      publicationYear: r.year,
      language: r.language,
      instanceCount: r.copies,
      rating: r.rating,
      catalogueStatus: r.catalogue_status,
      isRare: r.is_rare,
      huntAssessedOn: r.hunt_assessed_on,
      isPoison: r.is_poison,
      acquisitionPriority: r.acquisition_priority,
      primaryEditionId: r.edition_id,
    };
  });
}

/** The values each filter can take, with their book counts, over all of the house's books */
export async function getPublisherBookFacets(publisherId: string): Promise<PublisherBookFacets> {
  z.uuid().parse(publisherId);
  const family = sql`(select publisher_family(${publisherId}::uuid))`;
  const editionsOf = sql`from editions e join works w on w.id = e.work_id and w.kind = 'book'
    where exists (select 1 from edition_publishers ep where ep.edition_id = e.id and ep.publisher_id in ${family})`;
  const [languages, bindings, years, authors, imprints] = await Promise.all([
    db.execute(sql`select e.language as value, count(distinct e.work_id)::int as count ${editionsOf} and e.language is not null group by 1 order by 2 desc, 1`),
    db.execute(sql`select e.binding as value, count(distinct e.work_id)::int as count ${editionsOf} and e.binding is not null group by 1 order by 2 desc, 1`),
    db.execute(sql`select min(e.publication_year)::int as min, max(e.publication_year)::int as max ${editionsOf}`),
    db.execute(sql`select a.id, a.name, count(distinct e.work_id)::int as count
      from editions e join works w on w.id = e.work_id and w.kind = 'book'
      join work_authors wa on wa.work_id = w.id join authors a on a.id = wa.author_id
      where exists (select 1 from edition_publishers ep where ep.edition_id = e.id and ep.publisher_id in ${family})
      group by a.id, a.name, coalesce(a.sort_name, a.name) order by coalesce(a.sort_name, a.name)`),
    db.execute(sql`select h.id, h.name, count(distinct e.work_id)::int as count
      from editions e join works w on w.id = e.work_id and w.kind = 'book'
      join edition_publishers ep on ep.edition_id = e.id
      join publishing_houses h on h.id = ep.publisher_id
      where ep.publisher_id in ${family} and h.id <> ${publisherId}::uuid
      group by h.id, h.name order by h.name`),
  ]);
  return {
    languages: resultRows(languages),
    bindings: resultRows(bindings),
    years: resultRows<{ min: number | null; max: number | null }>(years)[0] ?? { min: null, max: null },
    authors: resultRows(authors),
    imprints: resultRows(imprints),
  };
}

/** How many of the house's books there are, and how many are owned, wanted or on order */
export async function getPublisherCounts(publisherId: string) {
  z.uuid().parse(publisherId);
  const family = sql`(select publisher_family(${publisherId}::uuid))`;
  const state = editionState(sql`e.id`);
  const [row] = resultRows<{ books: number; editions: number; owned: number; wanted: number; on_order: number }>(
    await db.execute(sql`select count(distinct work_id)::int as books, count(*)::int as editions,
        count(distinct work_id) filter (where owned)::int as owned,
        count(distinct work_id) filter (where wanted)::int as wanted,
        count(distinct work_id) filter (where on_order)::int as on_order
      from (select e.work_id, ${state.owned} as owned, ${state.wanted} as wanted, ${state.onOrder} as on_order
        from editions e join works w on w.id = e.work_id and w.kind = 'book'
        where exists (select 1 from edition_publishers ep where ep.edition_id = e.id and ep.publisher_id in ${family})) x`),
  );
  return { books: row.books, editions: row.editions, owned: row.owned, wanted: row.wanted, onOrder: row.on_order };
}

/** Books where an edition from this house (or its imprints) is the one wanted, not yet received */
export async function getPublisherTargets(publisherId: string) {
  z.uuid().parse(publisherId);
  return db
    .select({ id: acquisitionTargets.id, work: { slug: works.slug, id: works.id, title: works.title }, state: targetState, publisher: houses.name })
    .from(acquisitionTargets)
    .innerJoin(works, eq(works.id, acquisitionTargets.workId))
    .innerJoin(houses, eq(houses.id, acquisitionTargets.publisherId))
    .where(
      and(
        sql`${houses.id} in (select publisher_family(${publisherId}::uuid))`,
        eq(acquisitionTargets.isCancelled, false),
        sql`(${targetState}) <> 'received'`,
      ),
    )
    .orderBy(asc(works.title));
}

/** The house's active logo and background */
export async function getPublisherImages(publisherId: string) {
  z.uuid().parse(publisherId);
  const rows = await db
    .select()
    .from(media)
    .where(and(eq(media.organizationId, publisherId), eq(media.isActive, true)));
  return {
    logo: rows.find((m) => m.type === "poster") ?? null,
    background: rows.find((m) => m.type === "background") ?? null,
  };
}
