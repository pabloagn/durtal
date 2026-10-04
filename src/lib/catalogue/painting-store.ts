import { randomUUID } from "node:crypto";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/lib/db";
import {
  works,
  artObjectCredits,
  artObjectTaxa,
  workArtMovements,
} from "@/lib/db/schema";
import { dateFromColumns } from "./dates";
import { uuids, type Db } from "./work-store";
import { textSearchCondition } from "@/lib/actions/utils/text-search";
import { resultRows } from "@/lib/harmonization/store";
import type {
  objectCreditSchema,
  paintingQuerySchema,
} from "@/lib/validations/paintings";

/** Painting works always carry their typed profile. */
export const paintingDomain = sql`${works.kind} = 'painting' and exists(select 1 from painting_details pd where pd.work_id = ${works.id})`;

// ── Snapshots for optimistic concurrency ─────────────────────────────────────

/** Painting identity sections. Objects and curation have their own fingerprints. */
export function paintingFingerprint(id: string) {
  return sql`(select md5(jsonb_build_object(
    'title',w.title,'description',w.description,'slug',w.slug,'details',to_jsonb(d),
    'taxa',coalesce((select jsonb_agg(t.item_id order by t.item_id) from custom_taxonomy_item_works t where t.work_id=w.id),'[]'),
    'movements',coalesce((select jsonb_agg(m.art_movement_id order by m.art_movement_id) from work_art_movements m where m.work_id=w.id),'[]'),
    'credits',coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order,c.id) from work_credits c where c.work_id=w.id),'[]')
  )::text) from works w join painting_details d on d.work_id=w.id where w.id=${id}::uuid and w.kind='painting')`;
}
/** `id` may be a parameter or an outer column; inner aliases never shadow it. */
export function objectFingerprint(id: SQL) {
  return sql`(select md5(jsonb_build_object('object',to_jsonb(ao),
    'credits',coalesce((select jsonb_agg(to_jsonb(c) order by c.sort_order,c.id) from art_object_credits c where c.object_id=ao.id),'[]'),
    'taxa',coalesce((select jsonb_agg(to_jsonb(t) order by t.item_id) from art_object_taxa t where t.object_id=ao.id),'[]')
  )::text) from art_objects ao where ao.id=${id})`;
}

/** One object's whole location history: any edit to it changes this value. */
export function whereaboutsFingerprint(objectId: SQL) {
  return sql`(select md5(coalesce(jsonb_agg(to_jsonb(w) order by w.id),'[]'::jsonb)::text)
    from art_object_whereabouts w where w.object_id=${objectId})`;
}

// ── Section writers ──────────────────────────────────────────────────────────

export function insertArtMovements(d: Db, workId: string, ids: string[]) {
  return ids.length
    ? [
        d
          .insert(workArtMovements)
          .values(ids.map((artMovementId) => ({ workId, artMovementId }))),
      ]
    : [];
}
export function insertObjectCredits(
  d: Db,
  objectId: string,
  list: z.output<typeof objectCreditSchema>[],
) {
  return list.length
    ? [
        d.insert(artObjectCredits).values(
          list.map((credit, sortOrder) => ({
            ...credit,
            id: credit.id ?? randomUUID(),
            objectId,
            sortOrder,
          })),
        ),
      ]
    : [];
}
export function insertObjectTaxa(d: Db, objectId: string, ids: string[]) {
  return ids.length
    ? [
        d
          .insert(artObjectTaxa)
          .values(ids.map((itemId) => ({ objectId, itemId }))),
      ]
    : [];
}

// ── Effective object values ──────────────────────────────────────────────────

export interface ObjectTaxon {
  itemId: string;
  name: string;
  familyId: string;
  familySlug: string;
  inherited: boolean;
}
export interface ObjectValues {
  attribution: Attributed[];
  classification: ObjectTaxon[];
}
export interface Attributed {
  id: string;
  personId: string | null;
  name: string | null;
  creditedAs: string | null;
  attribution: string;
  sortOrder: number;
  inherited: boolean;
}
/**
 * Attribution and classification of each object, resolved in bulk. An
 * overridden object uses its own attribution; a family present on an object
 * replaces the painting's values for that family only.
 */
export async function loadObjectValues(
  workId: string,
  objects: { id: string; attributionOverride: boolean }[],
) {
  const objectIds = objects.map((object) => object.id);
  if (!objectIds.length) return new Map<string, ObjectValues>();
  const [painters, credits, workTaxa, objectTaxa] = await Promise.all([
    db.execute(sql`select c.id,c.person_id as "personId",a.name,c.credited_as as "creditedAs",c.attribution,c.sort_order as "sortOrder"
      from work_credits c left join authors a on a.id=c.person_id
      where c.work_id=${workId}::uuid and c.role_id='painting.painter' order by c.sort_order,c.id`),
    db.execute(sql`select c.id,c.object_id as "objectId",c.person_id as "personId",a.name,c.credited_as as "creditedAs",c.attribution,c.sort_order as "sortOrder"
      from art_object_credits c left join authors a on a.id=c.person_id
      where c.object_id in (${uuids(objectIds)}) order by c.sort_order,c.id`),
    db.execute(sql`select i.id as "itemId",i.name,f.id as "familyId",f.slug as "familySlug"
      from custom_taxonomy_item_works t join custom_taxonomy_items i on i.id=t.item_id join taxonomy_families f on f.id=i.family_id
      where t.work_id=${workId}::uuid
        and exists(select 1 from taxonomy_applicability a where a.family_id=f.id and a.kind='painting' and a.level='art_object')
      order by f.slug,i.name,i.id`),
    db.execute(sql`select t.object_id as "objectId",i.id as "itemId",i.name,f.id as "familyId",f.slug as "familySlug"
      from art_object_taxa t join custom_taxonomy_items i on i.id=t.item_id join taxonomy_families f on f.id=i.family_id
      where t.object_id in (${uuids(objectIds)}) order by f.slug,i.name,i.id`),
  ]);
  type Credit = Omit<Attributed, "inherited">;
  type Taxon = Omit<ObjectTaxon, "inherited">;
  const workPainters = resultRows<Credit>(painters);
  const objectCreditRows = resultRows<Credit & { objectId: string }>(credits);
  const inheritedTaxa = resultRows<Taxon>(workTaxa);
  const ownTaxa = resultRows<Taxon & { objectId: string }>(objectTaxa);
  return new Map<string, ObjectValues>(
    objects.map(({ id: objectId, attributionOverride }) => {
      const own = ownTaxa.filter((t) => t.objectId === objectId);
      const families = new Set(own.map((t) => t.familyId));
      return [
        objectId,
        {
          attribution: attributionOverride
              ? objectCreditRows
                  .filter((c) => c.objectId === objectId)
                .map(({ objectId: _object, ...c }) => ({ ...c, inherited: false }))
            : workPainters.map((c) => ({ ...c, inherited: true })),
          classification: [
            ...own.map(({ objectId: _object, ...t }) => ({ ...t, inherited: false })),
            ...inheritedTaxa
              .filter((t) => !families.has(t.familyId))
              .map((t) => ({ ...t, inherited: true })),
          ].sort(
            (a, b) =>
              a.familySlug.localeCompare(b.familySlug) ||
              a.name.localeCompare(b.name),
          ),
        },
      ];
    }),
  );
}

// ── Current whereabouts ──────────────────────────────────────────────────────

export interface CurrentWhereabouts {
  id: string;
  objectId: string;
  placeKind: string;
  venueId: string | null;
  venueName: string | null;
  venueSlug: string | null;
  placeLabel: string | null;
  custody: string;
  displayStatus: string;
  occasionLabel: string | null;
  since: Parameters<typeof dateFromColumns>[0] | null;
  checkedAt: string;
}
/** The confirmed current location of each object, in one query. */
export async function loadCurrentWhereabouts(objectIds: string[]) {
  if (!objectIds.length) return new Map<string, CurrentWhereabouts>();
  const rows = resultRows<CurrentWhereabouts>(
    await db.execute(sql`select w.id,w.object_id as "objectId",w.place_kind as "placeKind",w.venue_id as "venueId",
      v.name as "venueName",v.slug as "venueSlug",w.place_label as "placeLabel",w.custody,w.display_status as "displayStatus",
      w.occasion_label as "occasionLabel",coalesce(w.verified_at,w.recorded_at) as "checkedAt",
      case when s.id is null then null else jsonb_build_object('precision',s.precision,'startYear',s.start_year,'startMonth',s.start_month,'startDay',s.start_day,
        'endYear',s.end_year,'endMonth',s.end_month,'endDay',s.end_day,'approximate',s.approximate,'label',s.label) end as since
      from art_object_whereabouts w left join venues v on v.id=w.venue_id left join catalogue_dates s on s.id=w.starts_on_id
      where w.object_id in (${uuids(objectIds)}) and w.certainty='confirmed' and w.ends_on_id is null`),
  );
  return new Map(rows.map((row) => [row.objectId, row]));
}

// ── List filters ─────────────────────────────────────────────────────────────

type PaintingQuery = z.output<typeof paintingQuerySchema>;

function taxonomyMatch(itemId: string) {
  return sql`exists(with recursive narrower(id) as (
      select ${itemId}::uuid union select i.id from custom_taxonomy_items i join narrower n on i.parent_id=n.id)
    select 1 from narrower n where
      exists(select 1 from custom_taxonomy_item_works t where t.work_id=${works.id} and t.item_id=n.id)
      or exists(select 1 from art_object_taxa ot join art_objects o on o.id=ot.object_id where o.work_id=${works.id} and ot.item_id=n.id))`;
}
const personallyHeld = sql`exists(select 1 from art_objects o where o.work_id=${works.id} and o.ownership='personal' and o.holding_status<>'disposed')`;
export const paintingCreationStart = sql`(select cd.lower_bound from painting_details pd join catalogue_dates cd on cd.id=pd.creation_date_id where pd.work_id=${works.id})`;

/** Results and counts share this one condition, so they cannot disagree. */
export function paintingWhere(q: PaintingQuery): SQL | undefined {
  const conditions: (SQL | undefined)[] = [];
  if (q.search)
    conditions.push(textSearchCondition(sql`search_normalize(${works.title})`, q.search));
  if (q.painterIds?.length)
    conditions.push(
      sql`(exists(select 1 from work_credits c where c.work_id=${works.id} and c.role_id='painting.painter' and c.person_id in (${uuids(q.painterIds)}))
        or exists(select 1 from art_object_credits c join art_objects o on o.id=c.object_id where o.work_id=${works.id} and c.person_id in (${uuids(q.painterIds)})))`,
    );
  for (const itemId of new Set(q.taxonomyItemIds ?? []))
    conditions.push(taxonomyMatch(itemId));
  if (q.artMovementIds?.length)
    conditions.push(
      sql`exists(select 1 from work_art_movements m where m.work_id=${works.id} and m.art_movement_id in (${uuids(q.artMovementIds)}))`,
    );
  if (q.ownerOrganizationIds?.length)
    conditions.push(
      sql`exists(select 1 from art_objects o where o.work_id=${works.id} and o.owner_organization_id in (${uuids(q.ownerOrganizationIds)}))`,
    );
  if (q.currentVenueIds?.length)
    conditions.push(
      sql`exists(select 1 from art_object_whereabouts w join art_objects o on o.id=w.object_id
        where o.work_id=${works.id} and w.certainty='confirmed' and w.ends_on_id is null and w.venue_id in (${uuids(q.currentVenueIds)}))`,
    );
  if (q.createdFrom !== undefined || q.createdTo !== undefined)
    conditions.push(
      sql`exists(select 1 from painting_details pd join catalogue_dates cd on cd.id=pd.creation_date_id
        where pd.work_id=${works.id} and cd.lower_bound is not null${
          q.createdFrom !== undefined
            ? sql` and cd.upper_bound >= ${q.createdFrom * 10000 + 101}`
            : sql``
        }${
          q.createdTo !== undefined
            ? sql` and cd.lower_bound <= ${q.createdTo * 10000 + 1231}`
            : sql``
        })`,
    );
  if (q.holding === "owned") conditions.push(personallyHeld);
  if (q.holding === "not_owned") conditions.push(sql`not ${personallyHeld}`);
  if (q.favourite !== undefined)
    conditions.push(eq(works.isFavourite, q.favourite));
  return and(...conditions);
}

/**
 * Card data for one page of IDs in a single query, in the page's order. The
 * primary object is the first original, else the first version; its size in
 * centimetres gives the card its native proportions.
 */
export async function loadPaintingCards(ids: string[]) {
  if (!ids.length) return [];
  const rows = resultRows<{
    id: string;
    slug: string | null;
    title: string;
    rating: number | null;
    isFavourite: boolean;
    createdAt: string;
    creationDate: Parameters<typeof dateFromColumns>[0] | null;
    painters: { id: string | null; name: string | null }[];
    primaryObject: {
      id: string;
      kind: string;
      label: string | null;
      heightCm: number | null;
      widthCm: number | null;
      owner: string | null;
      ownership: string;
    } | null;
    personalCount: number;
    poster: {
      s3Key: string;
      thumbnailS3Key: string | null;
      width: number | null;
      height: number | null;
      tone: string | null;
    } | null;
  }>(
    await db.execute(sql`select w.id,w.slug,w.title,w.rating,w.is_favourite as "isFavourite",w.created_at as "createdAt",
      case when cd.id is null then null else jsonb_build_object('precision',cd.precision,'startYear',cd.start_year,'startMonth',cd.start_month,'startDay',cd.start_day,
        'endYear',cd.end_year,'endMonth',cd.end_month,'endDay',cd.end_day,'approximate',cd.approximate,'label',cd.label) end as "creationDate",
      coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',coalesce(c.credited_as,a.name)) order by c.sort_order,c.id)
        from work_credits c left join authors a on a.id=c.person_id where c.work_id=w.id and c.role_id='painting.painter'),'[]') as painters,
      (select jsonb_build_object('id',o.id,'kind',o.kind,'label',o.label,'heightCm',o.height_cm,'widthCm',o.width_cm,'owner',coalesce(p.name,o.owner_label),'ownership',o.ownership)
        from art_objects o left join publishing_houses p on p.id=o.owner_organization_id
        where o.work_id=w.id and o.kind<>'reproduction' order by o.kind='version',o.created_at,o.id limit 1) as "primaryObject",
      (select count(*)::int from art_objects o where o.work_id=w.id and o.ownership='personal' and o.holding_status<>'disposed') as "personalCount",
      (select jsonb_build_object('s3Key',m.s3_key,'thumbnailS3Key',m.thumbnail_s3_key,'width',m.width,'height',m.height,'tone',m.color_palette->'dominant'->>'hex')
        from media m where m.work_id=w.id and m.type='poster' and m.is_active order by m.created_at desc,m.id limit 1) as poster
      from works w join painting_details d on d.work_id=w.id left join catalogue_dates cd on cd.id=d.creation_date_id
      where w.kind='painting' and w.id in (${uuids(ids)})`),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => !!row)
    .map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt),
      creationDate: row.creationDate ? dateFromColumns(row.creationDate) : null,
    }));
}
