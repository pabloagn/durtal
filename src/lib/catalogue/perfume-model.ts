import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  perfumeBottles,
  perfumeDetails,
  perfumeVariants,
} from "@/lib/db/schema";
import { perfumeHoldings } from "./holdings";
import { resultRows } from "@/lib/harmonization/store";
import type { NOTE_POSITIONS } from "./perfumes";
import type { Attribution } from "./credits";

async function requirePerfume(workId: string, variantId?: string) {
  z.uuid().parse(workId);
  if (variantId) z.uuid().parse(variantId);
  const profile = await db.query.perfumeDetails.findFirst({
    where: eq(perfumeDetails.workId, workId),
    columns: { workId: true },
  });
  if (!profile) throw new Error("Perfume not found");
  if (
    variantId &&
    !(await db.query.perfumeVariants.findFirst({
      where: and(
        eq(perfumeVariants.id, variantId),
        eq(perfumeVariants.workId, workId),
      ),
      columns: { id: true },
    }))
  )
    throw new Error("Formulation does not belong to this perfume");
}
/** Connect the shared personal-holdings contract to real perfume containers. */
export async function loadPerfumeHoldings(workId: string) {
  await requirePerfume(workId);
  const bottles = await db
    .select({
      id: perfumeBottles.id,
      container: perfumeBottles.container,
      status: perfumeBottles.status,
      remainingMl: perfumeBottles.remainingMl,
    })
    .from(perfumeBottles)
    .innerJoin(
      perfumeVariants,
      eq(perfumeBottles.variantId, perfumeVariants.id),
    )
    .where(eq(perfumeVariants.workId, workId));
  return perfumeHoldings(bottles);
}
export interface PerfumeClassification {
  familyId: string;
  familySlug: string;
  itemId: string;
  name: string;
  position: (typeof NOTE_POSITIONS)[number] | null;
  sortOrder: number;
  sourceRecordId: string | null;
  inherited: boolean;
}

/**
 * `checked`: the caller has just read this perfume and formulation, so the
 * existence check is skipped (one formulation after another, it would cost
 * two queries each).
 */
export async function loadPerfumePerfumers(
  workId: string,
  variantId?: string,
  checked = false,
) {
  if (!checked) await requirePerfume(workId, variantId);
  const variant = variantId ?? null;
  return resultRows<{
    id: string;
    personId: string | null;
    name: string | null;
    creditedAs: string | null;
    attribution: Attribution;
    sortOrder: number;
    inherited: boolean;
    sourceRecordId: string | null;
  }>(
    await db.execute(sql`
    with selected as (
      select id,person_id,credited_as,attribution,sort_order,${variant}::uuid is not null as inherited,null::uuid as source_record_id
      from work_credits where work_id=${workId}::uuid and role_id='perfume.perfumer'
        and not exists(select 1 from perfume_variants where id=${variant}::uuid and perfumers_override)
      union all
      select p.id,p.person_id,p.credited_as,p.attribution,p.sort_order,false,p.source_record_id
      from perfume_variant_perfumers p join perfume_variants v on v.id=p.variant_id where v.id=${variant}::uuid and v.perfumers_override
    ) select s.id,s.person_id as "personId",a.name,s.credited_as as "creditedAs",s.attribution,s.sort_order as "sortOrder",s.inherited,s.source_record_id as "sourceRecordId"
    from selected s left join authors a on a.id=s.person_id order by s.sort_order,s.id
  `),
  );
}
type PerfumerRow = Awaited<ReturnType<typeof loadPerfumePerfumers>>[number];

/**
 * The effective perfumers and classification of several formulations of one
 * perfume in two queries, not two per formulation (SLN-381): the same rows,
 * in the same order, as `loadPerfumePerfumers` and `loadPerfumeClassification`
 * for each one. The caller has just read the perfume and these formulations.
 */
export async function loadVariantsInheritance(workId: string, variantIds: string[]) {
  const out = new Map<string, { perfumers: PerfumerRow[]; classification: PerfumeClassification[] }>(
    variantIds.map((id) => [id, { perfumers: [], classification: [] }]),
  );
  if (!variantIds.length) return out;
  const ids = sql`array[${sql.join(variantIds.map((id) => sql`${id}`), sql`, `)}]::uuid[]`;
  const [perfumers, classification] = await Promise.all([
    db.execute(sql`
    with vs(variant_id) as (select unnest(${ids})), selected as (
      select vs.variant_id,c.id,c.person_id,c.credited_as,c.attribution,c.sort_order,true as inherited,null::uuid as source_record_id
      from vs join work_credits c on c.work_id=${workId}::uuid and c.role_id='perfume.perfumer'
      where not exists(select 1 from perfume_variants v where v.id=vs.variant_id and v.perfumers_override)
      union all
      select vs.variant_id,p.id,p.person_id,p.credited_as,p.attribution,p.sort_order,false,p.source_record_id
      from vs join perfume_variants v on v.id=vs.variant_id and v.perfumers_override join perfume_variant_perfumers p on p.variant_id=v.id
    ) select s.variant_id as "variantId",s.id,s.person_id as "personId",a.name,s.credited_as as "creditedAs",s.attribution,s.sort_order as "sortOrder",s.inherited,s.source_record_id as "sourceRecordId"
    from selected s left join authors a on a.id=s.person_id order by s.variant_id,s.sort_order,s.id
  `),
    db.execute(sql`
    with vs(variant_id) as (select unnest(${ids})), work_values as (
      select item_id,null::text as position,0 as sort_order,null::uuid as source_record_id from custom_taxonomy_item_works where work_id=${workId}::uuid
      union all select item_id,position,sort_order,source_record_id from perfume_notes where work_id=${workId}::uuid
    ), variant_values as (
      select variant_id,item_id,null::text as position,0 as sort_order,source_record_id from perfume_variant_taxa where variant_id=any(${ids})
      union all select variant_id,item_id,position,sort_order,source_record_id from perfume_variant_notes where variant_id=any(${ids})
    ), selected as (
      select vs.variant_id,w.item_id,w.position,w.sort_order,w.source_record_id,true as inherited
      from vs cross join work_values w join custom_taxonomy_items i on i.id=w.item_id
      where not exists(select 1 from perfume_variant_overrides o where o.variant_id=vs.variant_id and o.family_id=i.family_id)
      union all select v.variant_id,v.item_id,v.position,v.sort_order,v.source_record_id,false from variant_values v
    ) select s.variant_id as "variantId",f.id as "familyId",f.slug as "familySlug",i.id as "itemId",i.name,s.position,s.sort_order as "sortOrder",s.source_record_id as "sourceRecordId",s.inherited
      from selected s join custom_taxonomy_items i on i.id=s.item_id join taxonomy_families f on f.id=i.family_id
      order by s.variant_id,f.slug,case s.position when 'top' then 0 when 'heart' then 1 when 'base' then 2 else 3 end,s.sort_order,i.name,i.id
  `),
  ]);
  for (const { variantId, ...row } of resultRows<PerfumerRow & { variantId: string }>(perfumers))
    out.get(variantId)?.perfumers.push(row);
  for (const { variantId, ...row } of resultRows<PerfumeClassification & { variantId: string }>(classification))
    out.get(variantId)?.classification.push(row);
  return out;
}
/** A replacement is per family; an explicit empty override never falls back. */
export async function loadPerfumeClassification(
  workId: string,
  variantId?: string,
  checked = false,
) {
  if (!checked) await requirePerfume(workId, variantId);
  const variant = variantId ?? null;
  return resultRows<PerfumeClassification>(
    await db.execute(sql`
    with work_values as (
      select item_id,null::text as position,0 as sort_order,null::uuid as source_record_id from custom_taxonomy_item_works where work_id=${workId}::uuid
      union all select item_id,position,sort_order,source_record_id from perfume_notes where work_id=${workId}::uuid
    ), variant_values as (
      select item_id,null::text as position,0 as sort_order,source_record_id from perfume_variant_taxa where variant_id=${variant}::uuid
      union all select item_id,position,sort_order,source_record_id from perfume_variant_notes where variant_id=${variant}::uuid
    ), selected as (
      select w.*,${variant}::uuid is not null as inherited from work_values w join custom_taxonomy_items i on i.id=w.item_id
      where not exists(select 1 from perfume_variant_overrides o where o.variant_id=${variant}::uuid and o.family_id=i.family_id)
      union all select v.*,false as inherited from variant_values v
    ) select f.id as "familyId",f.slug as "familySlug",i.id as "itemId",i.name,s.position,s.sort_order as "sortOrder",s.source_record_id as "sourceRecordId",s.inherited
      from selected s join custom_taxonomy_items i on i.id=s.item_id join taxonomy_families f on f.id=i.family_id
      order by f.slug,case s.position when 'top' then 0 when 'heart' then 1 when 'base' then 2 else 3 end,s.sort_order,i.name,i.id
  `),
  );
}
