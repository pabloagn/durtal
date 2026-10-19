"use server";

import { sql, inArray, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { works, workAuthors } from "@/lib/db/schema";
import { loadTaxonomyFamily as getTaxonomyFamily } from "@/lib/catalogue/taxonomy-read";
import {
  familyItemCondition,
  itemProjection,
  linkRows,
  taxonomyStorage,
  type TaxonomyItem,
} from "@/lib/catalogue/taxonomy-storage";
import { getEnabledWorkKinds } from "@/lib/catalogue/domains";
import { WORK_KINDS, type WorkKind } from "@/lib/catalogue/kinds";
import { resultRows } from "@/lib/harmonization/store";
import { parsePagination, type ListSearchParams } from "@/lib/utils/pagination";
import { textSearchCondition } from "./utils/text-search";
import { workCardExtras, posterTone } from "./utils/work-card-query";
import { z } from "zod";

const SMALL_TREE = 192;
/** Every open collection the family applies to: a theme counts its films as well as its books (SLN-1157) */
function visibleKinds(family: { applicability: { kind: WorkKind }[] }): WorkKind[] {
  const applies = new Set(family.applicability.map((s) => s.kind));
  const kinds = getEnabledWorkKinds().filter((k) => applies.has(k));
  return kinds.length ? kinds : ["book"];
}

/** Bounded list data. Rich descriptions and off-page rows never enter the page payload. */
export async function getTaxonomyBrowsePage(
  familySlug: string,
  params: ListSearchParams = {},
  parent?: string,
  offset = 0,
) {
  const family = await getTaxonomyFamily(familySlug);
  if (!family) return null;
  if (parent) z.uuid().parse(parent);
  z.number().int().min(0).max(2147483647).parse(offset);
  const storage = taxonomyStorage(family),
    kinds = visibleKinds(family);
  const { page, perPage, offset: pageOffset } = parsePagination(params);
  const query = typeof params.q === "string" ? params.q.slice(0, 200) : "";
  const requested = typeof params.sort === "string" ? params.sort : "manual";
  const sort =
    requested === "most-used" || requested === "alphabetical"
      ? requested
      : storage.columns.has("sort_order")
        ? "manual"
        : "alphabetical";
  const condition =
    textSearchCondition(sql`search_normalize(i.name)`, query, {
      fuzzy: false,
    }) ?? sql`true`;
  const order =
    sort === "most-used"
      ? sql`"entityCount" desc, lower(name),id`
      : sort === "manual"
        ? sql`"sortOrder",lower(name),id`
        : sql`name collate "en-x-icu",id`;
  const parentCol = storage.columns.has("parent_id")
    ? sql`i.parent_id`
    : sql`null::uuid`;
  const sortCol = storage.columns.has("sort_order")
    ? sql`i.sort_order`
    : sql`0`;
  const children = storage.columns.has("parent_id")
    ? sql`select parent_id,count(*)::int n from ${sql.identifier(storage.table)} i where ${familyItemCondition(storage, family.id)} group by parent_id`
    : sql`select null::uuid parent_id,0 n where false`;
  const [row] = resultRows<{
    items: TaxonomyItem[];
    total: number;
    familyTotal: number;
    wholeTree: boolean;
    nested: boolean;
  }>(
    await db.execute(sql`
    with all_items as materialized (
      select i.id,i.name,coalesce(i.slug,i.id::text) slug,i.color,${parentCol} as "parentId",${sortCol} as "sortOrder",
        coalesce(c.n,0)::int as "childCount",coalesce(l.n,0)::int as "entityCount",coalesce(l.all_n,0)::int as "linkCount"
      from ${sql.identifier(storage.table)} i
      left join (${children}) c on c.parent_id=i.id
      left join (select item_id,count(*) filter(where kind in (${sql.join(
        kinds.map((k) => sql`${k}`),
        sql`,`,
      )})) n,count(*) all_n from (${linkRows(storage, WORK_KINDS)}) links group by item_id) l on l.item_id=i.id
      where ${familyItemCondition(storage, family.id)}),
    mode as (select count(*)::int as n,${family.hierarchical} and count(*)<=${SMALL_TREE} as whole from all_items),
    matched as (select * from all_items i where ((select whole from mode) and ${!parent} or ${condition})
      and (${parent ? sql`"parentId"=${parent}::uuid` : sql`(select whole from mode) or not ${family.hierarchical} or ${!!query.trim()} or "parentId" is null`})),
    shown as (select * from matched order by ${order} limit (case when (select whole from mode) and ${!parent} then ${SMALL_TREE}::bigint else ${perPage}::bigint end)
      offset (case when (select whole from mode) and ${!parent} then 0 else ${parent ? offset : pageOffset}::bigint end))
    select coalesce((select jsonb_agg(shown) from shown),'[]'::jsonb) items,(select count(*)::int from matched) total,
      (select n from mode) as "familyTotal",(select whole from mode) as "wholeTree",
      exists(select 1 from all_items where "parentId" is not null) nested`),
  );
  return { ...row, page, perPage, sort, query };
}

/** Dialog choices are loaded only when an editor is opened. */
export async function getTaxonomyEditorChoices(familySlug: string) {
  const family = await getTaxonomyFamily(familySlug);
  if (!family) return [];
  const s = taxonomyStorage(family);
  return resultRows<{ id: string; name: string; parentId: string | null }>(
    await db.execute(
      sql`select i.id,i.name,${s.columns.has("parent_id") ? sql`i.parent_id` : sql`null::uuid`} as "parentId" from ${sql.identifier(s.table)} i where ${familyItemCondition(s, family.id)} order by i.name,i.id`,
    ),
  );
}

/** Term metadata without materializing every linked id; shared by layout and metadata. */
export async function getTaxonomyTerm(familySlug: string, itemSlug: string) {
  const family = await getTaxonomyFamily(familySlug);
  if (!family) return null;
  const s = taxonomyStorage(family),
    kinds = visibleKinds(family);
  const parent = s.columns.has("parent_id")
    ? sql`i.parent_id`
    : sql`null::uuid`;
  const [context] = resultRows<
    TaxonomyItem & {
      parents: { id: string; name: string; slug: string }[];
      children: { id: string; name: string; slug: string }[];
      direct: number;
      below: number;
      kindCounts: { kind: WorkKind; count: number }[];
    }
  >(
    await db.execute(sql`
    with recursive selected as (select ${itemProjection(s)},0 as "entityCount" from ${sql.identifier(s.table)} i where ${familyItemCondition(s, family.id)} and (i.slug=${itemSlug} or i.id::text=${itemSlug})),
    family_items as (select i.id,i.name,coalesce(i.slug,i.id::text) slug,${parent} as parent from ${sql.identifier(s.table)} i where ${familyItemCondition(s, family.id)}),
    ancestors as (select *,1 as depth,array[id] path from family_items where id=(select "parentId" from selected) union all select p.*,a.depth+1,a.path||p.id from family_items p join ancestors a on p.id=a.parent where not p.id=any(a.path)),
    descendants as (select id,array[id] path from family_items where parent=(select id from selected) union all select c.id,d.path||c.id from family_items c join descendants d on c.parent=d.id where not c.id=any(d.path)),
    links as materialized (select * from (${linkRows(s, kinds)}) l where level=${family.entityLevel}),
    counts as (select kind,count(distinct owner_id)::int count from links where item_id=(select id from selected) group by kind)
    select selected.*,coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'slug',slug) order by depth desc) from ancestors),'[]'::jsonb) parents,
      coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'slug',slug) order by name,id) from family_items where parent=(select id from selected)),'[]'::jsonb) children,
      (select count(distinct owner_id)::int from links where item_id=(select id from selected)) direct,
      (select count(distinct owner_id)::int from links where item_id in (select id from descendants)) below,
      coalesce((select jsonb_agg(counts) from counts),'[]'::jsonb) as "kindCounts" from selected`),
  );
  if (!context) return null;
  // In the order the collections are listed
  const kindCounts = [...context.kindCounts].sort(
    (a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind),
  );
  return { ...context, kindCounts, kinds };
}

/** SQL chooses only the requested book page; editions map to their parent works without duplicates. */
export async function getTaxonomyBookPage(
  familySlug: string,
  itemId: string,
  params: ListSearchParams,
) {
  const f = await getTaxonomyFamily(familySlug);
  if (!f) return { ids: [] as string[], total: 0, ...parsePagination(params) };
  const s = taxonomyStorage(f),
    { page, perPage, offset } = parsePagination(params);
  // Numeric runs sort by magnitude, text by English primary collation, as the title collator does.
  const [row] = resultRows<{ ids: string[]; total: number }>(
    await db.execute(sql`
    with ids as (select distinct coalesce(w.id,e.work_id) id from (${linkRows(s, ["book"])}) l
      left join works w on l.level='work' and w.id=l.owner_id left join editions e on l.level='edition' and e.id=l.owner_id
      where l.item_id=${itemId}::uuid and l.level=${f.entityLevel}),
    ordered as (select w.id from works w join ids on ids.id=w.id order by
      array(select case when part[1] ~ '^[0-9]+$' then '0'||lpad(length(ltrim(part[1],'0'))::text,10,'0')||ltrim(part[1],'0') else '1'||lower(unaccent(part[1])) end from regexp_matches(trim(w.title),'([0-9]+|[^0-9]+)','g') part) collate "en-x-icu",w.id limit ${perPage} offset ${offset})
    select coalesce((select jsonb_agg(id) from ordered),'[]'::jsonb) ids,(select count(*)::int from ids) total`),
  );
  return { ...row, page, perPage };
}

export async function getTaxonomyBookCards(ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.query.works.findMany({
    where: inArray(works.id, ids),
    columns: {
      id: true,
      slug: true,
      title: true,
      rating: true,
      catalogueStatus: true,
      acquisitionPriority: true,
      isRare: true,
      huntAssessedOn: true,
      isPoison: true,
      isFavourite: true,
    },
    extras: workCardExtras,
    with: {
      workAuthors: {
        columns: {},
        with: { author: { columns: { id: true, name: true, slug: true } } },
        orderBy: asc(workAuthors.sortOrder),
      },
      editions: {
        columns: {
          id: true,
          coverS3Key: true,
          thumbnailS3Key: true,
          publicationYear: true,
          language: true,
        },
        with: { instances: { columns: { id: true } } },
      },
      media: {
        columns: {
          s3Key: true,
          thumbnailS3Key: true,
          type: true,
          isActive: true,
          cropX: true,
          cropY: true,
          cropZoom: true,
          brightness: true,
          contrast: true,
        },
        extras: posterTone,
      },
    },
  });
  const order = new Map(ids.map((id, index) => [id, index]));
  return rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}
