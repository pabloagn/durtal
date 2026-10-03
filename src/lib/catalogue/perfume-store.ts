import { randomUUID } from "node:crypto";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/lib/db";
import {
  works,
  organizationRoles,
  perfumeNotes,
  perfumeOrganizations,
  perfumeVariantNotes,
  perfumeVariantPerfumers,
  perfumeVariantTaxa,
} from "@/lib/db/schema";
import type { NON_PUBLISHING_ROLES } from "./organizations";
import { dateFromColumns } from "./dates";
import { orderWithin, uuids, type Db } from "./work-store";
import { textSearchCondition } from "@/lib/actions/utils/text-search";
import { resultRows } from "@/lib/harmonization/store";
import type {
  perfumeNoteInputSchema,
  perfumeOrganizationInputSchema,
  perfumeQuerySchema,
} from "@/lib/validations/perfumes";
import type { PERFUME_CONCENTRATIONS, variantPerfumerSchema } from "./perfumes";

/** Perfume works always carry their typed profile. */
export const perfumeDomain = sql`${works.kind} = 'perfume' and exists(select 1 from perfume_details pd where pd.work_id = ${works.id})`;

// ── Snapshots for optimistic concurrency ─────────────────────────────────────
// Each fingerprint is the md5 of one record's full stored state. A save locks
// the record, then compares the fingerprint the editor read with the current
// one inside the same transaction.

/** Fragrance identity sections; personal curation has its own fingerprint. */
export function perfumeFingerprint(id: string) {
  return sql`(select md5(jsonb_build_object(
    'title',w.title,'description',w.description,'slug',w.slug,'details',to_jsonb(d),
    'organizations',coalesce((select jsonb_agg(to_jsonb(o) order by o.role,o.sort_order,o.organization_id) from perfume_organizations o where o.work_id=w.id),'[]'),
    'notes',coalesce((select jsonb_agg(to_jsonb(n) order by n.position,n.sort_order,n.item_id) from perfume_notes n where n.work_id=w.id),'[]'),
    'taxa',coalesce((select jsonb_agg(t.item_id order by t.item_id) from custom_taxonomy_item_works t where t.work_id=w.id),'[]'),
    'credits',coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order,c.id) from work_credits c where c.work_id=w.id),'[]')
  )::text) from works w join perfume_details d on d.work_id=w.id where w.id=${id}::uuid and w.kind='perfume')`;
}
/** `id` may be a parameter or an outer column; inner aliases never shadow it. */
export function variantFingerprint(id: SQL) {
  return sql`(select md5(jsonb_build_object('variant',to_jsonb(pv),
    'overrides',coalesce((select jsonb_agg(o.family_id order by o.family_id) from perfume_variant_overrides o where o.variant_id=pv.id),'[]'),
    'taxa',coalesce((select jsonb_agg(to_jsonb(t) order by t.item_id) from perfume_variant_taxa t where t.variant_id=pv.id),'[]'),
    'notes',coalesce((select jsonb_agg(to_jsonb(n) order by n.position,n.sort_order,n.item_id) from perfume_variant_notes n where n.variant_id=pv.id),'[]'),
    'perfumers',coalesce((select jsonb_agg(to_jsonb(p) order by p.sort_order,p.id) from perfume_variant_perfumers p where p.variant_id=pv.id),'[]')
  )::text) from perfume_variants pv where pv.id=${id})`;
}
export function bottleFingerprint(id: SQL) {
  return sql`(select md5(to_jsonb(pb)::text) from perfume_bottles pb where pb.id=${id})`;
}
// ── Section writers (built on the transaction connection) ────────────────────

/**
 * Naming an organization as a house, brand, manufacturer or retailer gives it
 * that role, in the same write: the database requires the role, and the user
 * chose it. A role it already has stays as it is; no other role is added.
 */
export function organizationRoleQueries(
  d: Db,
  list: { organizationId: string; role: (typeof NON_PUBLISHING_ROLES)[number] }[],
) {
  const unique = [
    ...new Map(list.map((o) => [`${o.organizationId}:${o.role}`, o])).values(),
  ];
  return unique.length
    ? [
        d
          .insert(organizationRoles)
          .values(
            unique.map(({ organizationId, role }) => ({ organizationId, role })),
          )
          .onConflictDoNothing(),
      ]
    : [];
}

export function insertOrganizations(
  d: Db,
  workId: string,
  list: z.output<typeof perfumeOrganizationInputSchema>[],
) {
  return list.length
    ? [
        ...organizationRoleQueries(d, list),
        d.insert(perfumeOrganizations).values(
          orderWithin(list, (o) => o.role).map((o) => ({ ...o, workId })),
        ),
      ]
    : [];
}
export function insertNotes(
  d: Db,
  owner: { workId: string } | { variantId: string },
  list: z.output<typeof perfumeNoteInputSchema>[],
) {
  if (!list.length) return [];
  const rows = orderWithin(list, (n) => n.position);
  return "workId" in owner
    ? [
        d
          .insert(perfumeNotes)
          .values(rows.map((n) => ({ ...n, workId: owner.workId }))),
      ]
    : [
        d
          .insert(perfumeVariantNotes)
          .values(rows.map((n) => ({ ...n, variantId: owner.variantId }))),
      ];
}
export function insertVariantTaxa(
  d: Db,
  variantId: string,
  itemIds: string[],
) {
  return itemIds.length
    ? [
        d
          .insert(perfumeVariantTaxa)
          .values(itemIds.map((itemId) => ({ itemId, variantId }))),
      ]
    : [];
}
export function insertVariantPerfumers(
  d: Db,
  variantId: string,
  list: z.output<typeof variantPerfumerSchema>[],
) {
  return list.length
    ? [
        d.insert(perfumeVariantPerfumers).values(
          list.map((perfumer, sortOrder) => ({
            ...perfumer,
            id: perfumer.id ?? randomUUID(),
            variantId,
            sortOrder,
          })),
        ),
      ]
    : [];
}
// ── List filters ─────────────────────────────────────────────────────────────

type PerfumeQuery = z.output<typeof perfumeQuerySchema>;

/** An item or any narrower item, on the fragrance or on one of its formulations. */
function taxonomyMatch(itemId: string) {
  return sql`exists(with recursive narrower(id) as (
      select ${itemId}::uuid union select i.id from custom_taxonomy_items i join narrower n on i.parent_id=n.id)
    select 1 from narrower n where
      exists(select 1 from custom_taxonomy_item_works t where t.work_id=${works.id} and t.item_id=n.id)
      or exists(select 1 from perfume_notes pn where pn.work_id=${works.id} and pn.item_id=n.id)
      or exists(select 1 from perfume_variant_taxa vt join perfume_variants v on v.id=vt.variant_id where v.work_id=${works.id} and vt.item_id=n.id)
      or exists(select 1 from perfume_variant_notes vn join perfume_variants v on v.id=vn.variant_id where v.work_id=${works.id} and vn.item_id=n.id))`;
}
function activeContainers(containers?: readonly string[]) {
  return sql`exists(select 1 from perfume_bottles b join perfume_variants v on v.id=b.variant_id
    where v.work_id=${works.id} and b.status<>'disposed'${
      containers?.length
        ? sql` and b.container in (${sql.join(
            containers.map((c) => sql`${c}`),
            sql`,`,
          )})`
        : sql``
    })`;
}
/** Results and counts share this one condition, so they cannot disagree. */
export function perfumeWhere(q: PerfumeQuery): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];
  if (q.search)
    conditions.push(
      textSearchCondition(
        sql`search_normalize(${works.title} || ' ' || coalesce((select string_agg(p.name,' ') from perfume_organizations o join publishing_houses p on p.id=o.organization_id where o.work_id=${works.id}),''))`,
        q.search,
      ),
    );
  if (q.houseIds?.length)
    conditions.push(
      sql`exists(select 1 from perfume_organizations o where o.work_id=${works.id} and o.role in ('perfume_house','brand') and o.organization_id in (${uuids(q.houseIds)}))`,
    );
  if (q.perfumerIds?.length)
    conditions.push(
      sql`(exists(select 1 from work_credits c where c.work_id=${works.id} and c.role_id='perfume.perfumer' and c.person_id in (${uuids(q.perfumerIds)}))
        or exists(select 1 from perfume_variant_perfumers vp join perfume_variants v on v.id=vp.variant_id where v.work_id=${works.id} and vp.person_id in (${uuids(q.perfumerIds)})))`,
    );
  for (const itemId of new Set(q.taxonomyItemIds ?? []))
    conditions.push(taxonomyMatch(itemId));
  if (q.concentrations?.length)
    conditions.push(
      sql`exists(select 1 from perfume_variants v where v.work_id=${works.id} and v.concentration in (${sql.join(
        q.concentrations.map((c) => sql`${c}`),
        sql`,`,
      )}))`,
    );
  if (q.releaseYearFrom !== undefined || q.releaseYearTo !== undefined)
    conditions.push(
      sql`exists(select 1 from perfume_details pd join catalogue_dates rd on rd.id=pd.release_date_id
        where pd.work_id=${works.id} and rd.lower_bound is not null${
          q.releaseYearFrom !== undefined
            ? sql` and rd.upper_bound >= ${q.releaseYearFrom * 10000 + 101}`
            : sql``
        }${
          q.releaseYearTo !== undefined
            ? sql` and rd.lower_bound <= ${q.releaseYearTo * 10000 + 1231}`
            : sql``
        })`,
    );
  if (q.holding === "owned" || q.containers?.length)
    conditions.push(activeContainers(q.containers));
  if (q.holding === "not_owned")
    conditions.push(sql`not ${activeContainers()}`);
  if (q.favourite !== undefined)
    conditions.push(eq(works.isFavourite, q.favourite));
  return and(...conditions);
}

/** Card data for one page of IDs in a single query, in the page's order. */
export async function loadPerfumeCards(ids: string[]) {
  if (!ids.length) return [];
  const rows = resultRows<{
    id: string;
    slug: string | null;
    title: string;
    rating: number | null;
    isFavourite: boolean;
    createdAt: string;
    releaseDate: Parameters<typeof dateFromColumns>[0] | null;
    organizations: { id: string; name: string; slug: string | null; role: string }[];
    perfumers: { id: string | null; name: string | null }[];
    /** Each formulation's concentration, oldest first */
    formulations: {
      concentration: (typeof PERFUME_CONCENTRATIONS)[number] | null;
      concentrationLabel: string | null;
    }[];
    holdings: { bottles: number; samples: number; decants: number };
    poster: {
      s3Key: string;
      thumbnailS3Key: string | null;
      cropX: number;
      cropY: number;
      cropZoom: number;
      /** The image's main color, for its frame while it loads */
      tone: string | null;
    } | null;
  }>(
    await db.execute(sql`select w.id,w.slug,w.title,w.rating,w.is_favourite as "isFavourite",w.created_at as "createdAt",
      case when rd.id is null then null else jsonb_build_object('precision',rd.precision,'startYear',rd.start_year,'startMonth',rd.start_month,'startDay',rd.start_day,
        'endYear',rd.end_year,'endMonth',rd.end_month,'endDay',rd.end_day,'approximate',rd.approximate,'label',rd.label) end as "releaseDate",
      coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'slug',p.slug,'role',o.role)
        order by case o.role when 'perfume_house' then 0 when 'brand' then 1 else 2 end,o.sort_order,p.id)
        from perfume_organizations o join publishing_houses p on p.id=o.organization_id where o.work_id=w.id),'[]') as organizations,
      coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',coalesce(c.credited_as,a.name)) order by c.sort_order,c.id)
        from work_credits c left join authors a on a.id=c.person_id where c.work_id=w.id and c.role_id='perfume.perfumer'),'[]') as perfumers,
      coalesce((select jsonb_agg(jsonb_build_object('concentration',v.concentration,'concentrationLabel',v.concentration_label) order by v.created_at,v.id)
        from perfume_variants v where v.work_id=w.id),'[]') as formulations,
      (select jsonb_build_object('bottles',count(*) filter (where b.container='bottle'),'samples',count(*) filter (where b.container='sample'),
        'decants',count(*) filter (where b.container='decant'))
        from perfume_bottles b join perfume_variants v on v.id=b.variant_id where v.work_id=w.id and b.status<>'disposed') as holdings,
      (select jsonb_build_object('s3Key',m.s3_key,'thumbnailS3Key',m.thumbnail_s3_key,'cropX',m.crop_x,'cropY',m.crop_y,'cropZoom',m.crop_zoom,
        'tone',m.color_palette->'dominant'->>'hex')
        from media m where m.work_id=w.id and m.type='poster' and m.is_active order by m.created_at desc,m.id limit 1) as poster
      from works w join perfume_details d on d.work_id=w.id left join catalogue_dates rd on rd.id=d.release_date_id
      where w.kind='perfume' and w.id in (${uuids(ids)})`),
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
        personallyOwned:
          row.holdings.bottles + row.holdings.samples + row.holdings.decants >
          0,
      },
    }));
}
