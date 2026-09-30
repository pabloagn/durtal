import { randomUUID } from "node:crypto";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/lib/db";
import {
  works,
  filmCountries,
  filmLanguages,
  filmOrganizations,
  filmReleases,
} from "@/lib/db/schema";
import { dateFromColumns } from "./dates";
import { newDate, orderWithin, uuids, type Db } from "./work-store";
import { textSearchCondition } from "@/lib/actions/utils/text-search";
import { resultRows } from "@/lib/harmonization/store";
import type {
  filmOrganizationInputSchema,
  filmQuerySchema,
  filmReleaseInputSchema,
} from "@/lib/validations/films";

/** Film works always carry their typed profile. */
export const filmDomain = sql`${works.kind} = 'film' and exists(select 1 from film_details fd where fd.work_id = ${works.id})`;

// ── Snapshots for optimistic concurrency ─────────────────────────────────────

/**
 * Film identity sections. Versions have their own fingerprints, so adding one
 * never invalidates an open film edit; curation has its own fingerprint too.
 */
export function filmFingerprint(id: string) {
  return sql`(select md5(jsonb_build_object(
    'title',w.title,'description',w.description,'slug',w.slug,'details',to_jsonb(d),
    'countries',coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order,x.country_id) from film_countries x where x.work_id=w.id),'[]'),
    'languages',coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order,x.language_id) from film_languages x where x.work_id=w.id),'[]'),
    'organizations',coalesce((select jsonb_agg(to_jsonb(o) order by o.role,o.sort_order,o.organization_id) from film_organizations o where o.work_id=w.id),'[]'),
    'taxa',coalesce((select jsonb_agg(t.item_id order by t.item_id) from custom_taxonomy_item_works t where t.work_id=w.id),'[]'),
    'credits',coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order,c.id) from work_credits c where c.work_id=w.id),'[]')
  )::text) from works w join film_details d on d.work_id=w.id where w.id=${id}::uuid and w.kind='film')`;
}
/**
 * `id` may be a parameter or an outer column; inner aliases never shadow it.
 * Display position belongs to the film's version order, so reordering never
 * invalidates an open version edit.
 */
export function versionFingerprint(id: SQL) {
  return sql`(select md5(jsonb_build_object('version',to_jsonb(fv) - 'sort_order',
    'releases',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from film_releases r where r.version_id=fv.id),'[]')
  )::text) from film_versions fv where fv.id=${id})`;
}
export function holdingFingerprint(id: SQL) {
  return sql`(select md5(to_jsonb(fh)::text) from film_holdings fh where fh.id=${id})`;
}

// ── Section writers ──────────────────────────────────────────────────────────

export function insertCountries(d: Db, workId: string, ids: string[]) {
  return ids.length
    ? [
        d.insert(filmCountries).values(
          ids.map((countryId, sortOrder) => ({ workId, countryId, sortOrder })),
        ),
      ]
    : [];
}
export function insertLanguages(d: Db, workId: string, ids: string[]) {
  return ids.length
    ? [
        d.insert(filmLanguages).values(
          ids.map((languageId, sortOrder) => ({
            workId,
            languageId,
            sortOrder,
          })),
        ),
      ]
    : [];
}
export function insertFilmOrganizations(
  d: Db,
  workId: string,
  list: z.output<typeof filmOrganizationInputSchema>[],
) {
  return list.length
    ? [
        d.insert(filmOrganizations).values(
          orderWithin(list, (o) => o.role).map((o) => ({ ...o, workId })),
        ),
      ]
    : [];
}
type ReleaseInput = z.output<typeof filmReleaseInputSchema>;
export function releaseRow(
  versionId: string,
  release: ReleaseInput,
  releaseDateId: string | null,
) {
  const { id: _id, releaseDate: _date, ...fields } = release;
  return { ...fields, versionId, releaseDateId };
}
/** New releases with their date values, ready to insert. */
export function newReleases(versionId: string, list: ReleaseInput[]) {
  return list.map((release) => {
    const date = newDate(release.releaseDate);
    return {
      date,
      row: { id: randomUUID(), ...releaseRow(versionId, release, date?.id ?? null) },
    };
  });
}
export function insertReleases(
  d: Db,
  rows: ReturnType<typeof newReleases>[number]["row"][],
) {
  return rows.length ? [d.insert(filmReleases).values(rows)] : [];
}

// ── List filters ─────────────────────────────────────────────────────────────

type FilmQuery = z.output<typeof filmQuerySchema>;

function taxonomyMatch(itemId: string) {
  return sql`exists(with recursive narrower(id) as (
      select ${itemId}::uuid union select i.id from custom_taxonomy_items i join narrower n on i.parent_id=n.id)
    select 1 from narrower n join custom_taxonomy_item_works t on t.item_id=n.id where t.work_id=${works.id})`;
}
function activeCopies(media?: readonly string[]) {
  return sql`exists(select 1 from film_holdings h where h.work_id=${works.id} and h.status<>'disposed'${
    media?.length
      ? sql` and h.medium in (${sql.join(
          media.map((m) => sql`${m}`),
          sql`,`,
        )})`
      : sql``
  })`;
}
/** The first version with a known runtime, in display order. */
export const primaryRuntime = sql`(select fv.runtime_seconds from film_versions fv where fv.work_id=${works.id} and fv.runtime_seconds is not null order by fv.sort_order,fv.id limit 1)`;
export const filmReleaseStart = sql`(select rd.lower_bound from film_details fd join catalogue_dates rd on rd.id=fd.release_date_id where fd.work_id=${works.id})`;

/** Results and counts share this one condition, so they cannot disagree. */
export function filmWhere(q: FilmQuery): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];
  if (q.search)
    conditions.push(
      textSearchCondition(
        sql`search_normalize(${works.title} || ' ' || coalesce((select fd.original_title from film_details fd where fd.work_id=${works.id}),''))`,
        q.search,
      ),
    );
  if (q.personIds?.length)
    conditions.push(
      sql`exists(select 1 from work_credits c where c.work_id=${works.id} and c.person_id in (${uuids(q.personIds)})${
        q.creditRoleIds?.length
          ? sql` and c.role_id in (${sql.join(
              q.creditRoleIds.map((r) => sql`${r}`),
              sql`,`,
            )})`
          : sql``
      })`,
    );
  for (const itemId of new Set(q.taxonomyItemIds ?? []))
    conditions.push(taxonomyMatch(itemId));
  if (q.countryIds?.length)
    conditions.push(
      sql`exists(select 1 from film_countries x where x.work_id=${works.id} and x.country_id in (${uuids(q.countryIds)}))`,
    );
  if (q.languageIds?.length)
    conditions.push(
      sql`exists(select 1 from film_languages x where x.work_id=${works.id} and x.language_id in (${uuids(q.languageIds)}))`,
    );
  if (q.releaseYearFrom !== undefined || q.releaseYearTo !== undefined)
    conditions.push(
      sql`exists(select 1 from film_details fd join catalogue_dates rd on rd.id=fd.release_date_id
        where fd.work_id=${works.id} and rd.lower_bound is not null${
          q.releaseYearFrom !== undefined
            ? sql` and rd.upper_bound >= ${q.releaseYearFrom * 10000 + 101}`
            : sql``
        }${
          q.releaseYearTo !== undefined
            ? sql` and rd.lower_bound <= ${q.releaseYearTo * 10000 + 1231}`
            : sql``
        })`,
    );
  if (q.holding === "owned" || q.media?.length)
    conditions.push(activeCopies(q.media));
  if (q.holding === "not_owned") conditions.push(sql`not ${activeCopies()}`);
  if (q.favourite !== undefined)
    conditions.push(eq(works.isFavourite, q.favourite));
  return and(...conditions);
}

/** Card data for one page of IDs in a single query, in the page's order. */
export async function loadFilmCards(ids: string[]) {
  if (!ids.length) return [];
  const rows = resultRows<{
    id: string;
    slug: string | null;
    title: string;
    originalTitle: string | null;
    rating: number | null;
    isFavourite: boolean;
    createdAt: string;
    releaseDate: Parameters<typeof dateFromColumns>[0] | null;
    runtimeSeconds: number | null;
    directors: { id: string | null; name: string | null }[];
    countries: { id: string; name: string; alpha2: string }[];
    holdings: { physical: number; digital: number };
    poster: {
      s3Key: string;
      thumbnailS3Key: string | null;
      cropX: number;
      cropY: number;
      cropZoom: number;
    } | null;
  }>(
    await db.execute(sql`select w.id,w.slug,w.title,d.original_title as "originalTitle",w.rating,w.is_favourite as "isFavourite",w.created_at as "createdAt",
      case when rd.id is null then null else jsonb_build_object('precision',rd.precision,'startYear',rd.start_year,'startMonth',rd.start_month,'startDay',rd.start_day,
        'endYear',rd.end_year,'endMonth',rd.end_month,'endDay',rd.end_day,'approximate',rd.approximate,'label',rd.label) end as "releaseDate",
      (select fv.runtime_seconds from film_versions fv where fv.work_id=w.id and fv.runtime_seconds is not null order by fv.sort_order,fv.id limit 1) as "runtimeSeconds",
      coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',coalesce(c.credited_as,a.name)) order by c.sort_order,c.id)
        from work_credits c left join authors a on a.id=c.person_id where c.work_id=w.id and c.role_id='film.director'),'[]') as directors,
      coalesce((select jsonb_agg(jsonb_build_object('id',k.id,'name',k.name,'alpha2',k.alpha_2) order by x.sort_order,k.id)
        from film_countries x join countries k on k.id=x.country_id where x.work_id=w.id),'[]') as countries,
      (select jsonb_build_object('physical',count(*) filter (where h.medium='physical'),'digital',count(*) filter (where h.medium='digital'))
        from film_holdings h where h.work_id=w.id and h.status<>'disposed') as holdings,
      (select jsonb_build_object('s3Key',m.s3_key,'thumbnailS3Key',m.thumbnail_s3_key,'cropX',m.crop_x,'cropY',m.crop_y,'cropZoom',m.crop_zoom)
        from media m where m.work_id=w.id and m.type='poster' and m.is_active order by m.created_at desc,m.id limit 1) as poster
      from works w join film_details d on d.work_id=w.id left join catalogue_dates rd on rd.id=d.release_date_id
      where w.kind='film' and w.id in (${uuids(ids)})`),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => !!row)
    .map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt),
      releaseDate: row.releaseDate ? dateFromColumns(row.releaseDate) : null,
      holdings: {
        ...row.holdings,
        personallyOwned: row.holdings.physical + row.holdings.digital > 0,
      },
    }));
}
