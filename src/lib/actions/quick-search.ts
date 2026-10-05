"use server";

import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { textSearchCondition, textSearchRank } from "@/lib/actions/utils/text-search";
import { WORK_DOMAINS, getEnabledWorkKinds } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { VENUE_TYPE_LABELS, type VenueType } from "@/lib/catalogue/venues";

export interface QuickSearchWork {
  id: string;
  kind: WorkKind;
  /** The work's page in its own collection: /library/…, /films/…, /perfumes/… */
  href: string;
  title: string;
  year: number | null;
  /** Its makers as the collection names them: authors, directors, the house, painters */
  creators: string[];
  /** The cover or poster thumbnail: the active poster, else (books) an edition's */
  cover: string | null;
}
export interface QuickSearchResult {
  /** The best matches of each open collection, best first within each */
  works: QuickSearchWork[];
  /** `photo`: the portrait thumbnail; `roles`: what they are in the catalogue */
  people: { id: string; name: string; href: string; photo: string | null; roles: string }[];
  organizations: { id: string; name: string; href: string; roles: string }[];
  venues: { id: string; name: string; href: string; type: string }[];
}

/** Matches per collection, and per group of people, organizations, venues */
const PER_KIND = 5;

const EMPTY: QuickSearchResult = { works: [], people: [], organizations: [], venues: [] };

/**
 * A work's search text: its title, series (its own name and the series it
 * belongs to) and the names its collection credits it to: book authors;
 * directors and writers; perfumers (of the fragrance or of one formulation)
 * and houses; painters. Credited-as names count, so "Leonardo" finds a
 * painting credited that way. Each collection reads only its own credits, so
 * a book costs what it did before.
 */
const workHaystack = sql`search_normalize(w.title
  || ' ' || coalesce(w.series_name, '')
  || ' ' || coalesce((select s.title from series s where s.id = w.series_id), '')
  || ' ' || case when w.kind = 'book'
    then coalesce((select string_agg(a.name, ' ') from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = w.id), '')
    else coalesce((select string_agg(coalesce(c.credited_as, a.name, ''), ' ') from work_credits c left join authors a on a.id = c.person_id
        where c.work_id = w.id and c.role_id in ('film.director', 'film.screenwriter', 'perfume.perfumer', 'painting.painter')), '')
      || case when w.kind = 'perfume' then
        ' ' || coalesce((select string_agg(o.name, ' ') from perfume_organizations po join publishing_houses o on o.id = po.organization_id where po.work_id = w.id), '')
        || ' ' || coalesce((select string_agg(coalesce(p.credited_as, a.name, ''), ' ') from perfume_variants v
          join perfume_variant_perfumers p on p.variant_id = v.id left join authors a on a.id = p.person_id where v.work_id = w.id), '')
      else '' end
  end)`;

/** The makers shown beside a result, in the collection's own terms */
const workCreators = (w: SQL) => sql`case ${w}.kind
  when 'book' then (select array_agg(a.name order by wa.sort_order, a.id) from work_authors wa join authors a on a.id = wa.author_id where wa.work_id = ${w}.id)
  when 'perfume' then (select array_agg(o.name order by po.sort_order, o.id) from perfume_organizations po join publishing_houses o on o.id = po.organization_id
    where po.work_id = ${w}.id and po.role in ('perfume_house', 'brand'))
  else (select array_agg(coalesce(c.credited_as, a.name) order by c.sort_order, c.id) from work_credits c left join authors a on a.id = c.person_id
    where c.work_id = ${w}.id and c.role_id in ('film.director', 'painting.painter') and coalesce(c.credited_as, a.name) is not null)
  end`;

const workCover = (w: SQL) => sql`coalesce(
  (select coalesce(m.thumbnail_s3_key, m.s3_key) from media m where m.work_id = ${w}.id and m.type = 'poster' and m.is_active order by m.created_at, m.id limit 1),
  case when ${w}.kind = 'book' then (select coalesce(e.thumbnail_s3_key, e.cover_s3_key) from editions e where e.work_id = ${w}.id
    and coalesce(e.thumbnail_s3_key, e.cover_s3_key) is not null order by e.publication_year desc nulls last, e.id limit 1) end)`;

/** A work's address in its collection; a book needs its slug, the others accept the id */
function workHref(kind: WorkKind, id: string, slug: string | null) {
  return `${WORK_DOMAINS[kind].basePath}/${slug ?? id}`;
}

async function searchWorks(q: string, kinds: WorkKind[]): Promise<QuickSearchWork[]> {
  const isbn = q.replace(/[-\s]/g, "");
  const isbnMatch = /^\d{9}[\dX]$|^\d{13}$/i.test(isbn)
    ? sql`exists (select 1 from editions e where e.work_id = w.id and (e.isbn_13 = ${isbn} or e.isbn_10 = ${isbn}))`
    : null;
  const hay = sql`h.hay`;
  const textMatch = textSearchCondition(hay, q);
  const match =
    isbnMatch && textMatch ? sql`(${isbnMatch} or ${textMatch})` : (isbnMatch ?? textMatch ?? null);
  if (!match || !kinds.length) return [];
  const list = sql.join(
    kinds.map((k) => sql`${k}`),
    sql`, `,
  );
  // The search text is built once per work (a materialized step: the matching
  // and ranking read it many times); makers and pictures only for shown rows
  const rows = resultRows<{
    id: string;
    kind: WorkKind;
    slug: string | null;
    title: string;
    year: number | null;
    creators: string[] | null;
    cover: string | null;
  }>(
    await db.execute(sql`with h as materialized (
        select w.id, ${workHaystack} as hay from works w
        where w.kind::text in (${list}) and (w.kind <> 'book' or w.slug is not null)
      ), found as (
        select w.id, w.kind, w.slug, w.title, w.original_year as year,
          row_number() over (partition by w.kind
            order by ${textSearchRank(hay, sql`w.title`, q)} desc, lower(w.title), w.id) as n
        from h join works w on w.id = h.id
        where ${match}
      )
      select f.id, f.kind, f.slug, f.title, f.year, ${workCreators(sql`f`)} as creators, ${workCover(sql`f`)} as cover
      from found f where f.n <= ${PER_KIND}
      order by array_position(array[${list}]::text[], f.kind::text), f.n`),
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    href: workHref(row.kind, row.id, row.slug),
    title: row.title,
    year: row.year,
    creators: row.creators ?? [],
    cover: row.cover,
  }));
}

/** What a person is in the open collections, by the roles they hold */
const PERSON_ROLES: { kind: WorkKind; role: string; label: string; filter?: string }[] = [
  { kind: "book", role: "author", label: "Writer" },
  { kind: "film", role: "film.director", label: "Director", filter: "/films?director=" },
  { kind: "film", role: "film.cast", label: "Cast", filter: "/films?cast=" },
  { kind: "perfume", role: "perfume.perfumer", label: "Perfumer", filter: "/perfumes?perfumer=" },
  { kind: "painting", role: "painting.painter", label: "Painter", filter: "/paintings?painter=" },
];

async function searchPeople(q: string, kinds: WorkKind[]) {
  const match = textSearchCondition(sql`a.search_text`, q);
  const alias = textSearchCondition(sql`pa.search_text`, q);
  if (!match || !alias) return [];
  const rows = resultRows<{
    id: string;
    slug: string | null;
    name: string;
    photo: string | null;
    isBook: boolean;
    roles: string[] | null;
    editionRole: string | null;
  }>(
    await db.execute(sql`select a.id, a.slug, a.name,
        coalesce((select coalesce(m.thumbnail_s3_key, m.s3_key) from media m where m.author_id = a.id and m.type = 'poster' and m.is_active
          order by m.created_at, m.id limit 1), a.photo_s3_key) as photo,
        exists (select 1 from person_domains pd where pd.person_id = a.id and pd.kind = 'book') as "isBook",
        array_remove(array[
          case when exists (select 1 from work_authors wa where wa.author_id = a.id) then 'author' end,
          case when exists (select 1 from work_credits c where c.person_id = a.id and c.role_id = 'film.director') then 'film.director' end,
          case when exists (select 1 from work_credits c where c.person_id = a.id and c.role_id = 'film.cast') then 'film.cast' end,
          case when exists (select 1 from work_credits c where c.person_id = a.id and c.role_id = 'perfume.perfumer')
            or exists (select 1 from perfume_variant_perfumers p where p.person_id = a.id) then 'perfume.perfumer' end,
          case when exists (select 1 from work_credits c where c.person_id = a.id and c.role_id = 'painting.painter') then 'painting.painter' end
        ], null) as roles,
        (select ec.role from edition_contributors ec where ec.author_id = a.id
          group by ec.role order by count(*) desc, ec.role limit 1) as "editionRole"
      from authors a
      where (${match} or exists (select 1 from person_aliases pa where pa.person_id = a.id and ${alias}))
      order by ${textSearchRank(sql`a.search_text`, sql`a.name`, q)} desc, lower(a.name), a.id
      limit ${PER_KIND * 3}`),
  );
  const open = new Set<WorkKind>(kinds);
  return rows
    .flatMap((row) => {
      const held = PERSON_ROLES.filter((r) => open.has(r.kind) && row.roles?.includes(r.role));
      // Every person in an open collection has their page (SLN-419); one
      // without a slug falls back to their collection's list
      const visible = held.length > 0 || (row.isBook && open.has("book"));
      const href = !visible
        ? null
        : row.slug
          ? `/people/${row.slug}`
          : held.find((r) => r.filter)?.filter?.concat(row.id);
      if (!href) return [];
      // A translator or editor of an edition: their most frequent edition role
      const labels = held.map((r) => r.label);
      if (row.editionRole && open.has("book")) {
        const role = row.editionRole.replace(/_/g, " ");
        labels.splice(row.roles?.includes("author") ? 1 : 0, 0, role.charAt(0).toUpperCase() + role.slice(1));
      }
      return [{ id: row.id, name: row.name, href, photo: row.photo, roles: labels.join(" · ") }];
    })
    .slice(0, PER_KIND);
}

/** The roles an organization can hold outside publishing, and the list each leads to, if any */
const ORGANIZATION_ROLES: { role: string; label: string; kind?: WorkKind; href?: (id: string) => string }[] = [
  { role: "perfume_house", label: "Perfume house", kind: "perfume", href: (id) => `/perfumes?house=${id}` },
  { role: "brand", label: "Brand", kind: "perfume", href: (id) => `/perfumes?house=${id}` },
  { role: "museum", label: "Museum", kind: "painting", href: (id) => `/paintings?institution=${id}` },
  { role: "gallery", label: "Gallery", kind: "painting", href: (id) => `/paintings?institution=${id}` },
  { role: "manufacturer", label: "Manufacturer" },
  { role: "retailer", label: "Retailer" },
  { role: "production_company", label: "Production company" },
  { role: "distribution_company", label: "Distributor" },
];
const PUBLISHING_LABELS: Record<string, string> = {
  group: "Publishing group",
  publisher: "Publisher",
  imprint: "Imprint",
};

async function searchOrganizations(q: string, kinds: WorkKind[]) {
  const match = textSearchCondition(sql`o.search_text`, q);
  const alias = textSearchCondition(sql`pa.search_text`, q);
  if (!match || !alias) return [];
  const rows = resultRows<{ id: string; slug: string; name: string; kind: string | null; roles: string[] }>(
    await db.execute(sql`select o.id, o.slug, o.name, o.kind,
        coalesce((select array_agg(r.role order by r.role) from organization_roles r where r.organization_id = o.id), '{}') as roles
      from publishing_houses o
      where (${match} or exists (select 1 from publisher_aliases pa where pa.publisher_id = o.id and ${alias}))
      order by ${textSearchRank(sql`o.search_text`, sql`o.name`, q)} desc, lower(o.name), o.id
      limit ${PER_KIND * 3}`),
  );
  const open = new Set<WorkKind>(kinds);
  return rows
    .flatMap((row) => {
      const roles = ORGANIZATION_ROLES.filter((r) => row.roles.includes(r.role));
      // Its publisher page, else the list of the collection it leads, else
      // its own page in the organization directory
      const href =
        row.kind && open.has("book")
          ? `/publishers/${row.slug}`
          : (roles.find((r) => r.href && r.kind && open.has(r.kind))?.href?.(row.id) ??
            `/organizations/${row.slug}`);
      const labels = [...(row.kind ? [PUBLISHING_LABELS[row.kind]] : []), ...roles.map((r) => r.label)];
      return [{ id: row.id, name: row.name, href, roles: labels.join(" · ") }];
    })
    .slice(0, PER_KIND);
}

async function searchVenues(q: string) {
  const match = textSearchCondition(sql`v.search_text`, q);
  if (!match) return [];
  const rows = resultRows<{ id: string; slug: string; name: string; type: VenueType }>(
    await db.execute(sql`select v.id, v.slug, v.name, v.type from venues v
      where v.archived_at is null and v.slug is not null and ${match}
      order by ${textSearchRank(sql`v.search_text`, sql`v.name`, q)} desc, lower(v.name), v.id
      limit ${PER_KIND}`),
  );
  return rows.map((v) => ({ id: v.id, name: v.name, href: `/places/${v.slug}`, type: VENUE_TYPE_LABELS[v.type] }));
}

/**
 * Search for the command palette: works of every open collection by title,
 * series, makers or ISBN, each linking to its own collection; people by any
 * name or other name, with what they are; organizations; venues. Accent-
 * insensitive and typo-tolerant, best matches first. The search text is
 * normalized to letters and digits, so "%" and "_" match nothing special.
 */
export async function quickSearch(query: string): Promise<QuickSearchResult> {
  const q = query.trim().slice(0, 200);
  if (q.length < 2) return EMPTY;
  const kinds = getEnabledWorkKinds();
  const [works, people, organizations, venues] = await Promise.all([
    searchWorks(q, kinds),
    searchPeople(q, kinds),
    searchOrganizations(q, kinds),
    searchVenues(q),
  ]);
  return { works, people, organizations, venues };
}
