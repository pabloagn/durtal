"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { readableDatabaseError, withReadableErrors } from "@/lib/db/errors";
import {
  works,
  perfumeDetails,
  perfumeVariants,
  perfumeBottles,
  perfumeOrganizations,
  perfumeNotes,
  perfumeVariantNotes,
  perfumeVariantOverrides,
  perfumeVariantPerfumers,
  perfumeVariantTaxa,
  customTaxonomyItemWorks,
  taxonomyFamilies,
  workCredits,
  publishingHouses,
  venues,
  locations,
  subLocations,
  comments,
  activityEvents,
  galleryLayouts,
  media,
} from "@/lib/db/schema";
import {
  createPerfumeSchema,
  createPerfumeVariantSchema,
  perfumeBottlePatchSchema,
  perfumeBottleRecordSchema,
  perfumeQuerySchema,
  PERFUME_BOTTLE_DEFAULTS,
  updatePerfumeSchema,
  updatePerfumeVariantSchema,
  type CreatePerfumeInput,
  type CreatePerfumeVariantInput,
  type PerfumeBottleInput,
  type PerfumeBottlePatch,
  type PerfumeQuery,
  type UpdatePerfumeInput,
  type UpdatePerfumeVariantInput,
} from "@/lib/validations/perfumes";
import { fingerprintSchema } from "@/lib/validations/records";
import {
  bottleFingerprint,
  insertNotes,
  insertOrganizations,
  insertVariantPerfumers,
  insertVariantTaxa,
  loadPerfumeCards,
  organizationRoleQueries,
  perfumeDomain,
  perfumeFingerprint,
  perfumeWhere,
  variantFingerprint,
} from "@/lib/catalogue/perfume-store";
import {
  STALE_RECORD,
  insertCredits,
  insertDates,
  insertWorkTaxa,
  loadDates,
  lockWork as lockAnyWork,
  newDate,
  readFingerprint,
  releaseDates,
  replaceDate,
  requireOwnIds,
  storedDate,
  supplied,
  type Db,
} from "@/lib/catalogue/work-store";
import {
  loadPerfumeClassification,
  loadPerfumePerfumers,
} from "@/lib/catalogue/perfume-model";
import { perfumeHoldings } from "@/lib/catalogue/holdings";
import { PERFUME_CONCENTRATIONS } from "@/lib/catalogue/perfumes";
import { alphabeticalWorkIds } from "./utils/alphabetical-works";
import { getCreditRoles, getWorkCredits } from "./credits";
import { getPerfumeRetailerLinks } from "./perfume-retailers";
import { generateWorkSlug } from "@/lib/utils/slugify";
import { uniqueSlug } from "@/lib/catalogue/slugs";
import { assertSql, resultRows } from "@/lib/harmonization/store";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { deleteUnusedObjects, ownedMediaObjects, workObjects } from "@/lib/s3/cleanup";

const NOTES_FAMILY = "perfume-notes";

const lockWork = (d: Db, workId: string) => lockAnyWork(d, workId, "perfume");

/** Every write is one transaction; database rule messages reach the caller as written. */
function write(build: Parameters<typeof atomic>[0]) {
  return withReadableErrors(() => atomic(build));
}

function changedCatalogue() {
  invalidate(
    CACHE_TAGS.works,
    CACHE_TAGS.authors,
    CACHE_TAGS.customTaxonomyItems,
  );
}
function changedHoldings() {
  invalidate(CACHE_TAGS.works, CACHE_TAGS.locations, CACHE_TAGS.venues);
}
function fresh(expected: string) {
  return (actual: string | null) => {
    if (actual === null) throw new Error("Record not found");
    if (actual !== expected) throw new Error(STALE_RECORD);
  };
}
async function perfumeCreditRoles(credits: { roleId: string }[]) {
  const roles = new Set((await getCreditRoles("perfume")).map((r) => r.id));
  if (credits.some((credit) => !roles.has(credit.roleId)))
    throw new Error("Contribution role does not apply to perfumes");
}
async function notesFamilyId() {
  const family = await db.query.taxonomyFamilies.findFirst({
    where: eq(taxonomyFamilies.slug, NOTES_FAMILY),
    columns: { id: true },
  });
  if (!family) throw new Error("The perfume note vocabulary is missing");
  return family.id;
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getPerfumes(input: PerfumeQuery = {}) {
  const q = perfumeQuerySchema.parse(input);
  const where = perfumeWhere(q);
  let ids: string[];
  if (q.sort === "title")
    ids = await alphabeticalWorkIds(
      where,
      q.limit,
      q.offset,
      q.order ?? "asc",
      perfumeDomain,
    );
  else {
    const direction = q.order ?? "desc";
    const key =
      q.sort === "release"
        ? sql`(select rd.lower_bound from perfume_details pd join catalogue_dates rd on rd.id=pd.release_date_id where pd.work_id=${works.id})`
        : q.sort === "rating"
          ? sql`${works.rating}`
          : sql`${works.createdAt}`;
    const rows = await db
      .select({ id: works.id })
      .from(works)
      .where(and(perfumeDomain, where))
      .orderBy(
        direction === "asc" ? sql`${key} asc nulls last` : sql`${key} desc nulls last`,
        asc(works.id),
      )
      .limit(q.limit)
      .offset(q.offset);
    ids = rows.map((row) => row.id);
  }
  return loadPerfumeCards(ids);
}
export async function getPerfumeCount(input: PerfumeQuery = {}) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(works)
    .where(and(perfumeDomain, perfumeWhere(perfumeQuerySchema.parse(input))));
  return row.count;
}

/** Families, accords and notes: the three vocabularies of the perfume filters. */
const FILTER_FAMILIES = ["perfume-families", "perfume-accords", NOTES_FAMILY] as const;

/**
 * What the perfume filters can offer: only values some perfume uses, with how
 * many perfumes use each, and the span of known release years. A family,
 * accord or note brings its broader items, which match their narrower ones.
 */
export async function getPerfumeFilterOptions() {
  const [houses, perfumers, items, concentrations, [years]] = await Promise.all([
    resultRows<{ id: string; name: string; count: number }>(
      await db.execute(sql`select p.id,p.name,count(distinct o.work_id)::int as count
        from perfume_organizations o join publishing_houses p on p.id=o.organization_id
        join works w on w.id=o.work_id and w.kind='perfume'
        where o.role in ('perfume_house','brand')
        group by p.id,p.name order by lower(p.name),p.id`),
    ),
    resultRows<{ id: string; name: string; count: number }>(
      await db.execute(sql`with credited as (
          select c.person_id,c.work_id from work_credits c join works w on w.id=c.work_id and w.kind='perfume'
          where c.role_id='perfume.perfumer' and c.person_id is not null
          union select p.person_id,v.work_id from perfume_variant_perfumers p join perfume_variants v on v.id=p.variant_id
          where p.person_id is not null)
        select a.id,a.name,count(distinct c.work_id)::int as count from credited c join authors a on a.id=c.person_id
        group by a.id,a.name order by lower(coalesce(a.sort_name,a.name)),a.id`),
    ),
    resultRows<{
      id: string;
      name: string;
      parentName: string | null;
      familySlug: (typeof FILTER_FAMILIES)[number];
      count: number;
    }>(
      await db.execute(sql`with recursive used(work_id,item_id) as (
          select t.work_id,t.item_id from custom_taxonomy_item_works t join works w on w.id=t.work_id and w.kind='perfume'
          union select work_id,item_id from perfume_notes
          union select v.work_id,t.item_id from perfume_variant_taxa t join perfume_variants v on v.id=t.variant_id
          union select v.work_id,n.item_id from perfume_variant_notes n join perfume_variants v on v.id=n.variant_id
        ), broader(work_id,item_id) as (
          select work_id,item_id from used
          union select b.work_id,i.parent_id from broader b join custom_taxonomy_items i on i.id=b.item_id where i.parent_id is not null
        )
        select i.id,i.name,p.name as "parentName",f.slug as "familySlug",count(distinct b.work_id)::int as count
        from broader b join custom_taxonomy_items i on i.id=b.item_id join taxonomy_families f on f.id=i.family_id
        left join custom_taxonomy_items p on p.id=i.parent_id
        where f.slug in (${sql.join(
          FILTER_FAMILIES.map((slug) => sql`${slug}`),
          sql`,`,
        )})
        group by i.id,i.name,p.name,f.slug
        order by f.slug,lower(coalesce(p.name || ' › ','') || i.name),i.id`),
    ),
    db
      .selectDistinct({ concentration: perfumeVariants.concentration })
      .from(perfumeVariants)
      .where(sql`${perfumeVariants.concentration} is not null`),
    resultRows<{ min: number | null; max: number | null }>(
      await db.execute(sql`select min(rd.start_year)::int as min,max(coalesce(rd.end_year,rd.start_year))::int as max
        from perfume_details pd join works w on w.id=pd.work_id and w.kind='perfume'
        join catalogue_dates rd on rd.id=pd.release_date_id where rd.start_year is not null`),
    ),
  ]);
  const used = new Set(concentrations.map((row) => row.concentration));
  return {
    houses,
    perfumers,
    families: items.filter((item) => item.familySlug === "perfume-families"),
    accords: items.filter((item) => item.familySlug === "perfume-accords"),
    notes: items.filter((item) => item.familySlug === NOTES_FAMILY),
    concentrations: PERFUME_CONCENTRATIONS.filter((c) => used.has(c)),
    releaseYears:
      years?.min != null && years.max != null
        ? { min: years.min, max: years.max }
        : null,
  };
}
export type PerfumeFilterOptions = Awaited<
  ReturnType<typeof getPerfumeFilterOptions>
>;

/** Up to `limit` perfume IDs from one query, excluding the ones already shown. */
async function relatedIds(query: ReturnType<typeof sql>) {
  return resultRows<{ id: string; names?: string[] }>(await db.execute(query));
}

/**
 * Fragrances to look at next, each row with its reason: more from the house,
 * more by the first perfumer, and fragrances that share at least two notes,
 * accords or families (on the fragrance or one of its formulations), most
 * shared first, with the shared names. A fragrance appears in one row only.
 */
export async function getRelatedPerfumes(id: string, limit = 12) {
  z.uuid().parse(id);
  z.number().int().min(1).max(48).parse(limit);
  const [house] = resultRows<{ id: string; name: string }>(
    await db.execute(sql`select p.id,p.name from perfume_organizations o join publishing_houses p on p.id=o.organization_id
      where o.work_id=${id}::uuid and o.role in ('perfume_house','brand')
      order by case o.role when 'perfume_house' then 0 else 1 end,o.sort_order,p.id limit 1`),
  );
  const [perfumer] = resultRows<{ id: string; name: string }>(
    await db.execute(sql`select a.id,a.name from work_credits c join authors a on a.id=c.person_id
      where c.work_id=${id}::uuid and c.role_id='perfume.perfumer' order by c.sort_order,c.id limit 1`),
  );
  const shown = new Set([id]);
  const excluded = () =>
    sql`(${sql.join(
      [...shown].map((s) => sql`${s}::uuid`),
      sql`,`,
    )})`;

  const houseIds = house
    ? await relatedIds(sql`select w.id from works w join perfume_organizations o on o.work_id=w.id
        where w.kind='perfume' and o.organization_id=${house.id}::uuid and o.role in ('perfume_house','brand')
          and w.id not in ${excluded()}
        group by w.id,w.title order by lower(w.title),w.id limit ${limit}`)
    : [];
  houseIds.forEach((row) => shown.add(row.id));

  const perfumerIds = perfumer
    ? await relatedIds(sql`select w.id from works w where w.kind='perfume' and w.id not in ${excluded()} and (
          exists(select 1 from work_credits c where c.work_id=w.id and c.role_id='perfume.perfumer' and c.person_id=${perfumer.id}::uuid)
          or exists(select 1 from perfume_variant_perfumers p join perfume_variants v on v.id=p.variant_id where v.work_id=w.id and p.person_id=${perfumer.id}::uuid))
        order by lower(w.title),w.id limit ${limit}`)
    : [];
  perfumerIds.forEach((row) => shown.add(row.id));

  const descriptors = sql`select work_id,item_id from perfume_notes
    union select t.work_id,t.item_id from custom_taxonomy_item_works t join works w on w.id=t.work_id and w.kind='perfume'
    union select v.work_id,n.item_id from perfume_variant_notes n join perfume_variants v on v.id=n.variant_id
    union select v.work_id,t.item_id from perfume_variant_taxa t join perfume_variants v on v.id=t.variant_id`;
  const similar = await relatedIds(sql`with d as (${descriptors})
    select t.work_id as id,jsonb_agg(i.name order by lower(i.name),i.id) as names
    from d t join d m on m.item_id=t.item_id and m.work_id=${id}::uuid
    join custom_taxonomy_items i on i.id=t.item_id
    where t.work_id not in ${excluded()}
    group by t.work_id having count(*)>=2
    order by count(*) desc,t.work_id limit ${limit}`);

  const [houseCards, perfumerCards, similarCards] = await Promise.all([
    loadPerfumeCards(houseIds.map((row) => row.id)),
    loadPerfumeCards(perfumerIds.map((row) => row.id)),
    loadPerfumeCards(similar.map((row) => row.id)),
  ]);
  return {
    house: house && houseCards.length ? { ...house, perfumes: houseCards } : null,
    perfumer:
      perfumer && perfumerCards.length
        ? { ...perfumer, perfumes: perfumerCards }
        : null,
    similar: similarCards.map((card) => ({
      ...card,
      shared: similar.find((row) => row.id === card.id)?.names ?? [],
    })),
  };
}

async function loadVariants(
  workId: string,
  ids?: string[],
) {
  const rows = await db
    .select({
      variant: perfumeVariants,
      fingerprint: sql<string>`${variantFingerprint(sql`${perfumeVariants.id}`)}`,
    })
    .from(perfumeVariants)
    .where(
      and(
        eq(perfumeVariants.workId, workId),
        ids ? inArray(perfumeVariants.id, ids) : undefined,
      ),
    )
    .orderBy(asc(perfumeVariants.createdAt), asc(perfumeVariants.id));
  if (!rows.length) return [];
  const variantIds = rows.map(({ variant }) => variant.id);
  const [dates, overrides, images] = await Promise.all([
    loadDates(
      rows.flatMap(({ variant }) => [
        variant.releaseDateId,
        variant.discontinuedDateId,
      ]),
    ),
    db
      .select()
      .from(perfumeVariantOverrides)
      .where(inArray(perfumeVariantOverrides.variantId, variantIds)),
    // Each formulation's active image, when it has its own
    db
      .selectDistinctOn([media.perfumeVariantId], {
        variantId: media.perfumeVariantId,
        s3Key: media.s3Key,
        thumbnailS3Key: media.thumbnailS3Key,
        tone: sql<string | null>`${media.colorPalette}->'dominant'->>'hex'`,
      })
      .from(media)
      .where(
        and(
          inArray(media.perfumeVariantId, variantIds),
          eq(media.type, "poster"),
          eq(media.isActive, true),
        ),
      )
      .orderBy(media.perfumeVariantId, desc(media.createdAt), asc(media.id)),
  ]);
  // Effective values come from the shared inheritance queries, one pair per
  // formulation of this fragrance.
  return Promise.all(
    rows.map(async ({ variant, fingerprint }) => {
      const [classification, perfumers] = await Promise.all([
        loadPerfumeClassification(workId, variant.id),
        loadPerfumePerfumers(workId, variant.id),
      ]);
      const image = images.find((row) => row.variantId === variant.id);
      return {
        ...variant,
        image: image
          ? {
              s3Key: image.s3Key,
              thumbnailS3Key: image.thumbnailS3Key,
              tone: image.tone,
            }
          : null,
        releaseDate: storedDate(dates, variant.releaseDateId),
        discontinuedDate: storedDate(dates, variant.discontinuedDateId),
        overriddenFamilyIds: overrides
          .filter((o) => o.variantId === variant.id)
          .map((o) => o.familyId),
        perfumers,
        notePyramid: classification.filter((c) => c.familySlug === NOTES_FAMILY),
        classification: classification.filter(
          (c) => c.familySlug !== NOTES_FAMILY,
        ),
        fingerprint,
      };
    }),
  );
}
async function loadBottles(where: ReturnType<typeof eq>) {
  const rows = await db
    .select({
      bottle: perfumeBottles,
      workId: perfumeVariants.workId,
      locationName: locations.name,
      subLocationName: subLocations.name,
      supplierName: publishingHouses.name,
      venueName: venues.name,
      fingerprint: sql<string>`${bottleFingerprint(sql`${perfumeBottles.id}`)}`,
    })
    .from(perfumeBottles)
    .innerJoin(perfumeVariants, eq(perfumeBottles.variantId, perfumeVariants.id))
    .leftJoin(locations, eq(perfumeBottles.locationId, locations.id))
    .leftJoin(subLocations, eq(perfumeBottles.subLocationId, subLocations.id))
    .leftJoin(publishingHouses, eq(perfumeBottles.supplierId, publishingHouses.id))
    .leftJoin(venues, eq(perfumeBottles.venueId, venues.id))
    .where(where)
    .orderBy(asc(perfumeBottles.createdAt), asc(perfumeBottles.id));
  const dates = await loadDates(
    rows.flatMap(({ bottle }) => [
      bottle.acquisitionDateId,
      bottle.dispositionDateId,
    ]),
  );
  return rows.map(({ bottle, ...rest }) => ({
    ...bottle,
    ...rest,
    acquisitionDate: storedDate(dates, bottle.acquisitionDateId),
    dispositionDate: storedDate(dates, bottle.dispositionDateId),
  }));
}

/** The whole fragrance: identity, formulations, containers and retailer listings. */
export async function getPerfume(idOrSlug: string) {
  z.string().min(1).max(1000).parse(idOrSlug);
  const byId = z.uuid().safeParse(idOrSlug).success;
  const [root] = await db
    .select({ work: works, details: perfumeDetails })
    .from(works)
    .innerJoin(perfumeDetails, eq(perfumeDetails.workId, works.id))
    .where(
      and(
        eq(works.kind, "perfume"),
        byId ? eq(works.id, idOrSlug) : eq(works.slug, idOrSlug),
      ),
    )
    .limit(1);
  if (!root) return null;
  const id = root.work.id;
  const [
    dates,
    organizations,
    credits,
    classification,
    variants,
    bottles,
    retailers,
    fingerprint,
  ] = await Promise.all([
    loadDates([root.details.releaseDateId, root.details.discontinuedDateId]),
    db
      .select({
        organizationId: perfumeOrganizations.organizationId,
        name: publishingHouses.name,
        slug: publishingHouses.slug,
        role: perfumeOrganizations.role,
        sortOrder: perfumeOrganizations.sortOrder,
        sourceRecordId: perfumeOrganizations.sourceRecordId,
      })
      .from(perfumeOrganizations)
      .innerJoin(
        publishingHouses,
        eq(perfumeOrganizations.organizationId, publishingHouses.id),
      )
      .where(eq(perfumeOrganizations.workId, id))
      .orderBy(
        sql`case ${perfumeOrganizations.role} when 'perfume_house' then 0 when 'brand' then 1 else 2 end`,
        asc(perfumeOrganizations.sortOrder),
        asc(perfumeOrganizations.organizationId),
      ),
    getWorkCredits(id),
    loadPerfumeClassification(id),
    loadVariants(id),
    loadBottles(eq(perfumeVariants.workId, id)),
    getPerfumeRetailerLinks({ workId: id, limit: 100 }),
    readFingerprint(perfumeFingerprint(id)),
  ]);
  const { work } = root;
  return {
    id,
    slug: work.slug,
    title: work.title,
    description: work.description,
    curation: {
      notes: work.notes,
      rating: work.rating,
      isFavourite: work.isFavourite,
    },
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    releaseDate: storedDate(dates, root.details.releaseDateId),
    discontinuedDate: storedDate(dates, root.details.discontinuedDateId),
    sourceRecordId: root.details.sourceRecordId,
    organizations,
    credits,
    notePyramid: classification.filter((c) => c.familySlug === NOTES_FAMILY),
    classification: classification.filter((c) => c.familySlug !== NOTES_FAMILY),
    variants,
    bottles,
    holdings: perfumeHoldings(
      bottles.map((b) => ({
        id: b.id,
        status: b.status,
        container: b.container,
        remainingMl: b.remainingMl,
      })),
    ),
    retailers,
    fingerprint: fingerprint!,
  };
}
export async function getPerfumeVariant(id: string) {
  z.uuid().parse(id);
  const row = await db.query.perfumeVariants.findFirst({
    where: eq(perfumeVariants.id, id),
    columns: { workId: true },
  });
  if (!row) return null;
  return (await loadVariants(row.workId, [id]))[0] ?? null;
}
export async function getPerfumeBottle(id: string) {
  z.uuid().parse(id);
  return (await loadBottles(eq(perfumeBottles.id, id)))[0] ?? null;
}

// ── Fragrance writes ─────────────────────────────────────────────────────────

/** Another work took the slug between the check and the write. */
function isSlugClash(error: unknown) {
  let current = error as
    | { code?: unknown; constraint?: unknown; constraint_name?: unknown; cause?: unknown }
    | undefined;
  for (let depth = 0; current && depth < 6; depth++) {
    if (
      current.code === "23505" &&
      [current.constraint, current.constraint_name].includes("works_slug_unique")
    )
      return true;
    current = current.cause as typeof current;
  }
  return false;
}

/**
 * The address of a new perfume: `{title}-by-{house}` (or the title alone),
 * numbered when taken, like a book's. If another work takes it during the
 * write, the next free one is tried; the last try adds the perfume's id.
 */
async function perfumeSlug(
  id: string,
  title: string,
  organizations: { organizationId: string; role: string }[],
  attempt: number,
) {
  const house =
    organizations.find((o) => o.role === "perfume_house") ??
    organizations.find((o) => o.role === "brand");
  const houseName = house
    ? ((
        await db.query.publishingHouses.findFirst({
          where: eq(publishingHouses.id, house.organizationId),
          columns: { name: true },
        })
      )?.name ?? "")
    : "";
  const base = generateWorkSlug(title, houseName, id);
  // "new" is the Add perfume page, /perfumes/new: a perfume never takes it
  return attempt < 2 ? uniqueSlug(works, base, { taken: ["new"] }) : `${base}-${id}`;
}

/**
 * One transaction writes the fragrance and every section. A flanker is created
 * here as its own fragrance; sizes belong to containers, never to a new work.
 */
export async function createPerfume(input: CreatePerfumeInput) {
  const v = createPerfumeSchema.parse(input);
  await perfumeCreditRoles(v.credits);
  if (v.credits.some((credit) => credit.id))
    throw new Error("A new perfume has no existing credits");
  const id = randomUUID();
  const release = newDate(v.releaseDate),
    discontinued = newDate(v.discontinuedDate);
  for (let attempt = 0; ; attempt++) {
    const slug = await perfumeSlug(id, v.title, v.organizations, attempt);
    try {
      await atomic((d) => [
        d.insert(works).values({
          id,
          kind: "perfume",
          title: v.title,
          slug,
          description: v.description || null,
          originalLanguage: null,
        }),
        ...insertDates(d, [release, discontinued]),
        d.insert(perfumeDetails).values({
          workId: id,
          releaseDateId: release?.id ?? null,
          discontinuedDateId: discontinued?.id ?? null,
        }),
        ...insertOrganizations(d, id, v.organizations),
        ...insertNotes(d, { workId: id }, v.notePyramid),
        ...insertWorkTaxa(d, id, v.classificationItemIds),
        ...insertCredits(d, id, v.credits, []),
      ]);
      break;
    } catch (error) {
      if (attempt < 2 && isSlugClash(error)) continue;
      throw readableDatabaseError(error);
    }
  }
  changedCatalogue();
  return (await getPerfume(id))!;
}

/**
 * Each supplied section replaces that section in one transaction. Omitted
 * sections, personal curation and source observations are never touched.
 */
export async function updatePerfume(
  id: string,
  input: UpdatePerfumeInput,
  fingerprint: string,
) {
  z.uuid().parse(id);
  const v = updatePerfumeSchema.parse(input);
  const expected = fingerprintSchema.parse(fingerprint);
  const details = await db.query.perfumeDetails.findFirst({
    where: eq(perfumeDetails.workId, id),
  });
  fresh(expected)(details ? await readFingerprint(perfumeFingerprint(id)) : null);
  if (v.credits) await perfumeCreditRoles(v.credits);
  const existingCredits = await db
    .select({ id: workCredits.id, createdAt: workCredits.createdAt })
    .from(workCredits)
    .where(eq(workCredits.workId, id));
  if (v.credits) requireOwnIds(v.credits, existingCredits, "credit");
  const dates = await loadDates([
    details!.releaseDateId,
    details!.discontinuedDateId,
  ]);
  const release = replaceDate(
    storedDate(dates, details!.releaseDateId),
    v.releaseDate,
  );
  const discontinued = replaceDate(
    storedDate(dates, details!.discontinuedDateId),
    v.discontinuedDate,
  );
  const profile = {
    ...(release && { releaseDateId: release.row?.id ?? null }),
    ...(discontinued && { discontinuedDateId: discontinued.row?.id ?? null }),
    ...(v.sourceRecordId !== undefined && { sourceRecordId: v.sourceRecordId }),
  };
  await write((d) => [
    lockWork(d, id),
    d.execute(
      assertSql(
        sql`coalesce(${perfumeFingerprint(id)}=${expected},false)`,
        STALE_RECORD,
      ),
    ),
    d
      .update(works)
      .set({
        ...(v.title !== undefined && { title: v.title }),
        ...(v.description !== undefined && {
          description: v.description || null,
        }),
        updatedAt: new Date(),
      })
      .where(and(eq(works.id, id), eq(works.kind, "perfume"))),
    ...insertDates(d, [release?.row, discontinued?.row]),
    ...(Object.keys(profile).length
      ? [
          d
            .update(perfumeDetails)
            .set(profile)
            .where(eq(perfumeDetails.workId, id)),
        ]
      : []),
    ...releaseDates(d, [release?.oldId, discontinued?.oldId]),
    ...(v.organizations
      ? [
          d
            .delete(perfumeOrganizations)
            .where(eq(perfumeOrganizations.workId, id)),
          ...insertOrganizations(d, id, v.organizations),
        ]
      : []),
    ...(v.notePyramid
      ? [
          d.delete(perfumeNotes).where(eq(perfumeNotes.workId, id)),
          ...insertNotes(d, { workId: id }, v.notePyramid),
        ]
      : []),
    ...(v.classificationItemIds
      ? [
          d
            .delete(customTaxonomyItemWorks)
            .where(eq(customTaxonomyItemWorks.workId, id)),
          ...insertWorkTaxa(d, id, v.classificationItemIds),
        ]
      : []),
    ...(v.credits
      ? [
          d.delete(workCredits).where(eq(workCredits.workId, id)),
          ...insertCredits(d, id, v.credits, existingCredits),
        ]
      : []),
  ]);
  changedCatalogue();
  return (await getPerfume(id))!;
}

/**
 * Containers and retailer history protect a fragrance. Comments, activity and
 * layouts go in the same transaction; its artwork is removed after commit.
 */
export async function deletePerfume(id: string) {
  z.uuid().parse(id);
  const details = await db.query.perfumeDetails.findFirst({
    where: eq(perfumeDetails.workId, id),
  });
  if (!details) throw new Error("Perfume not found");
  const [variantDates, stored] = await Promise.all([
    db
      .select({
        release: perfumeVariants.releaseDateId,
        discontinued: perfumeVariants.discontinuedDateId,
      })
      .from(perfumeVariants)
      .where(eq(perfumeVariants.workId, id)),
    // Read the file keys first: the cascade removes the rows that name them.
    workObjects(id),
  ]);
  const owner = (table: typeof comments | typeof activityEvents | typeof galleryLayouts) =>
    and(eq(table.entityType, "work"), eq(table.entityId, id));
  await write((d) => [
    lockWork(d, id),
    d.execute(
      assertSql(
        sql`exists(select 1 from works where id=${id}::uuid and kind='perfume')`,
        "Perfume not found",
      ),
    ),
    d.execute(
      assertSql(
        sql`not exists(select 1 from perfume_bottles b join perfume_variants v on v.id=b.variant_id where v.work_id=${id}::uuid)`,
        "Delete or move this perfume's bottles, samples and decants first",
      ),
    ),
    d.execute(
      assertSql(
        sql`not exists(select 1 from perfume_retailer_links where work_id=${id}::uuid)`,
        "Delete this perfume's retailer listings first; listings with recorded prices stay as history",
      ),
    ),
    d.delete(comments).where(owner(comments)),
    d.delete(activityEvents).where(owner(activityEvents)),
    d.delete(galleryLayouts).where(owner(galleryLayouts)),
    d.delete(works).where(and(eq(works.id, id), eq(works.kind, "perfume"))),
    ...releaseDates(d, [
      details.releaseDateId,
      details.discontinuedDateId,
      ...variantDates.flatMap((v) => [v.release, v.discontinued]),
    ]),
  ]);
  changedCatalogue();
  invalidate(CACHE_TAGS.media, CACHE_TAGS.comments, CACHE_TAGS.activity);
  const cleanupPending = await deleteUnusedObjects(stored, `perfume ${id}`);
  return { id, cleanupPending };
}

// ── Formulation writes ───────────────────────────────────────────────────────

function sameIdentity(
  workId: string,
  v: {
    concentration: string | null;
    concentrationLabel: string | null;
    formulationLabel: string | null;
  },
  excludeId?: string,
) {
  return assertSql(
    sql`not exists(select 1 from perfume_variants where work_id=${workId}::uuid
      and concentration is not distinct from ${v.concentration}
      and concentration_label is not distinct from ${v.concentrationLabel}
      and formulation_label is not distinct from ${v.formulationLabel}
      ${excludeId ? sql`and id<>${excludeId}::uuid` : sql``})`,
    "This perfume already has a formulation with this concentration and labels",
  );
}
/** Items listed under a family override must belong to that family. */
function familyItems(
  entries: { familyId: string; itemIds: string[] }[],
  notesFamily: string,
) {
  if (entries.some((e) => e.familyId === notesFamily))
    throw new Error("Record formulation notes in the note pyramid");
  return entries
    .filter((e) => e.itemIds.length)
    .map((e) =>
      assertSql(
        sql`(select count(*) from custom_taxonomy_items where family_id=${e.familyId}::uuid and id in (${sql.join(
          e.itemIds.map((item) => sql`${item}::uuid`),
          sql`,`,
        )}))=${e.itemIds.length}`,
        "An item does not belong to the family it replaces",
      ),
    );
}

export async function createPerfumeVariant(input: CreatePerfumeVariantInput) {
  const v = createPerfumeVariantSchema.parse(input);
  const notesFamily = await notesFamilyId();
  const checks = familyItems(v.classification, notesFamily);
  const id = randomUUID();
  const release = newDate(v.releaseDate),
    discontinued = newDate(v.discontinuedDate);
  await write((d) => [
    lockWork(d, v.workId),
    d.execute(
      assertSql(
        sql`exists(select 1 from perfume_details where work_id=${v.workId}::uuid)`,
        "Perfume not found",
      ),
    ),
    d.execute(sameIdentity(v.workId, v)),
    ...checks.map((check) => d.execute(check)),
    ...insertDates(d, [release, discontinued]),
    d.insert(perfumeVariants).values({
      id,
      workId: v.workId,
      concentration: v.concentration,
      concentrationLabel: v.concentrationLabel,
      formulationLabel: v.formulationLabel,
      perfumersOverride: v.perfumers !== null,
      releaseDateId: release?.id ?? null,
      discontinuedDateId: discontinued?.id ?? null,
      sourceRecordId: v.sourceRecordId,
      notes: v.notes,
    }),
    ...[
      ...(v.notePyramid ? [notesFamily] : []),
      ...v.classification.map((e) => e.familyId),
    ].map((familyId) =>
      d.insert(perfumeVariantOverrides).values({ variantId: id, familyId }),
    ),
    ...insertNotes(d, { variantId: id }, v.notePyramid ?? []),
    ...insertVariantTaxa(
      d,
      id,
      v.classification.flatMap((e) => e.itemIds),
    ),
    ...insertVariantPerfumers(d, id, v.perfumers ?? []),
  ]);
  changedCatalogue();
  return (await getPerfumeVariant(id))!;
}

/**
 * Supplied sections replace the formulation's own values; `null` perfumers or
 * notes restore inheritance, and families left out of `classification` inherit.
 */
export async function updatePerfumeVariant(
  id: string,
  input: UpdatePerfumeVariantInput,
  fingerprint: string,
) {
  z.uuid().parse(id);
  const v = updatePerfumeVariantSchema.parse(input);
  const expected = fingerprintSchema.parse(fingerprint);
  const current = await db.query.perfumeVariants.findFirst({
    where: eq(perfumeVariants.id, id),
  });
  fresh(expected)(
    current ? await readFingerprint(variantFingerprint(sql`${id}::uuid`)) : null,
  );
  const variant = current!;
  const identity = {
    concentration:
      v.concentration !== undefined ? v.concentration : variant.concentration,
    concentrationLabel:
      v.concentrationLabel !== undefined
        ? v.concentrationLabel
        : variant.concentrationLabel,
    formulationLabel:
      v.formulationLabel !== undefined
        ? v.formulationLabel
        : variant.formulationLabel,
  };
  if (identity.concentration === "other" && !identity.concentrationLabel)
    throw new Error("Describe the other concentration");
  const notesFamily = await notesFamilyId();
  const checks = v.classification
    ? familyItems(v.classification, notesFamily)
    : [];
  if (v.perfumers)
    requireOwnIds(
      v.perfumers,
      await db
        .select({ id: perfumeVariantPerfumers.id })
        .from(perfumeVariantPerfumers)
        .where(eq(perfumeVariantPerfumers.variantId, id)),
      "perfumer",
    );
  const dates = await loadDates([
    variant.releaseDateId,
    variant.discontinuedDateId,
  ]);
  const release = replaceDate(
    storedDate(dates, variant.releaseDateId),
    v.releaseDate,
  );
  const discontinued = replaceDate(
    storedDate(dates, variant.discontinuedDateId),
    v.discontinuedDate,
  );
  const overrideNotes = sql`${perfumeVariantOverrides.familyId}=${notesFamily}::uuid`;
  await write((d) => [
    lockWork(d, variant.workId),
    d.execute(
      sql`select id from perfume_variants where id=${id}::uuid for update`,
    ),
    d.execute(
      assertSql(
        sql`coalesce(${variantFingerprint(sql`${id}::uuid`)}=${expected},false)`,
        STALE_RECORD,
      ),
    ),
    d.execute(sameIdentity(variant.workId, identity, id)),
    ...checks.map((check) => d.execute(check)),
    ...insertDates(d, [release?.row, discontinued?.row]),
    // Attribution is replaced before inheritance is restored, and the
    // override is declared before formulation perfumers are inserted.
    ...(v.perfumers !== undefined
      ? [
          d
            .delete(perfumeVariantPerfumers)
            .where(eq(perfumeVariantPerfumers.variantId, id)),
        ]
      : []),
    d
      .update(perfumeVariants)
      .set({
        ...identity,
        ...(release && { releaseDateId: release.row?.id ?? null }),
        ...(discontinued && {
          discontinuedDateId: discontinued.row?.id ?? null,
        }),
        ...(v.sourceRecordId !== undefined && {
          sourceRecordId: v.sourceRecordId,
        }),
        ...(v.notes !== undefined && { notes: v.notes }),
        ...(v.perfumers !== undefined && {
          perfumersOverride: v.perfumers !== null,
        }),
        updatedAt: new Date(),
      })
      .where(eq(perfumeVariants.id, id)),
    ...insertVariantPerfumers(d, id, v.perfumers ?? []),
    ...releaseDates(d, [release?.oldId, discontinued?.oldId]),
    ...(v.notePyramid !== undefined
      ? [
          d
            .delete(perfumeVariantNotes)
            .where(eq(perfumeVariantNotes.variantId, id)),
          v.notePyramid === null
            ? d
                .delete(perfumeVariantOverrides)
                .where(
                  and(eq(perfumeVariantOverrides.variantId, id), overrideNotes),
                )
            : d
                .insert(perfumeVariantOverrides)
                .values({ variantId: id, familyId: notesFamily })
                .onConflictDoNothing(),
          ...insertNotes(d, { variantId: id }, v.notePyramid ?? []),
        ]
      : []),
    ...(v.classification
      ? [
          d
            .delete(perfumeVariantTaxa)
            .where(eq(perfumeVariantTaxa.variantId, id)),
          d
            .delete(perfumeVariantOverrides)
            .where(
              and(
                eq(perfumeVariantOverrides.variantId, id),
                sql`not (${overrideNotes})`,
              ),
            ),
          ...v.classification.map((e) =>
            d
              .insert(perfumeVariantOverrides)
              .values({ variantId: id, familyId: e.familyId }),
          ),
          ...insertVariantTaxa(
            d,
            id,
            v.classification.flatMap((e) => e.itemIds),
          ),
        ]
      : []),
  ]);
  changedCatalogue();
  return (await getPerfumeVariant(id))!;
}

export async function deletePerfumeVariant(id: string) {
  z.uuid().parse(id);
  const variant = await db.query.perfumeVariants.findFirst({
    where: eq(perfumeVariants.id, id),
  });
  if (!variant) throw new Error("Formulation not found");
  // Read the file keys first: the cascade removes the media rows that name them.
  const stored = await ownedMediaObjects("perfume_variant", id);
  await write((d) => [
    lockWork(d, variant.workId),
    d.execute(
      sql`select id from perfume_variants where id=${id}::uuid for update`,
    ),
    d.execute(
      assertSql(
        sql`not exists(select 1 from perfume_bottles where variant_id=${id}::uuid)`,
        "Delete or move this formulation's bottles, samples and decants first",
      ),
    ),
    d.execute(
      assertSql(
        sql`not exists(select 1 from perfume_retailer_links where variant_id=${id}::uuid)`,
        "Delete this formulation's retailer listings first; listings with recorded prices stay as history",
      ),
    ),
    d.delete(perfumeVariants).where(eq(perfumeVariants.id, id)),
    ...releaseDates(d, [variant.releaseDateId, variant.discontinuedDateId]),
  ]);
  changedCatalogue();
  const cleanupPending = await deleteUnusedObjects(stored, `perfume formulation ${id}`);
  return { id, cleanupPending };
}

// ── Container writes ─────────────────────────────────────────────────────────

/** The organization a container came from sells perfume: it is a retailer. */
function supplierRole(d: Db, supplierId: string | null) {
  return organizationRoleQueries(
    d,
    supplierId ? [{ organizationId: supplierId, role: "retailer" }] : [],
  );
}

function bottleValues(
  record: ReturnType<typeof perfumeBottleRecordSchema.parse>,
  dates: { acquisitionDateId: string | null; dispositionDateId: string | null },
) {
  const {
    acquisitionDate: _acquisition,
    dispositionDate: _disposition,
    ...fields
  } = record;
  return { ...fields, ...dates };
}

export async function addPerfumeBottle(input: PerfumeBottleInput) {
  const record = perfumeBottleRecordSchema.parse({
    ...PERFUME_BOTTLE_DEFAULTS,
    ...supplied(perfumeBottlePatchSchema.parse(input)),
  });
  const id = randomUUID();
  const acquisition = newDate(record.acquisitionDate),
    disposition = newDate(record.dispositionDate);
  await write((d) => [
    ...supplierRole(d, record.supplierId),
    ...insertDates(d, [acquisition, disposition]),
    d.insert(perfumeBottles).values({
      id,
      ...bottleValues(record, {
        acquisitionDateId: acquisition?.id ?? null,
        dispositionDateId: disposition?.id ?? null,
      }),
    }),
  ]);
  changedHoldings();
  return (await getPerfumeBottle(id))!;
}

/**
 * The patch is merged with the stored container and validated as a whole, so
 * quantity, price and disposition rules hold for the result. A container may
 * move to another formulation of the same fragrance only.
 */
export async function updatePerfumeBottle(
  id: string,
  input: PerfumeBottlePatch,
  fingerprint: string,
) {
  z.uuid().parse(id);
  const patch = supplied(perfumeBottlePatchSchema.parse(input));
  const expected = fingerprintSchema.parse(fingerprint);
  const current = await getPerfumeBottle(id);
  fresh(expected)(current?.fingerprint ?? null);
  const stored = current!;
  const record = perfumeBottleRecordSchema.parse({
    variantId: stored.variantId,
    container: stored.container,
    capacityValue: stored.capacityValue,
    volumeUnit: stored.volumeUnit,
    remainingMl: stored.remainingMl,
    status: stored.status,
    batchCode: stored.batchCode,
    condition: stored.condition,
    locationId: stored.locationId,
    subLocationId: stored.subLocationId,
    acquisitionDate: stored.acquisitionDate?.value ?? null,
    supplierId: stored.supplierId,
    venueId: stored.venueId,
    acquisitionPrice: stored.acquisitionPrice,
    acquisitionCurrency: stored.acquisitionCurrency,
    dispositionDate: stored.dispositionDate?.value ?? null,
    dispositionReason: stored.dispositionReason,
    notes: stored.notes,
    ...patch,
  });
  const acquisition = replaceDate(stored.acquisitionDate, patch.acquisitionDate);
  const disposition = replaceDate(stored.dispositionDate, patch.dispositionDate);
  await write((d) => [
    d.execute(
      sql`select id from perfume_bottles where id=${id}::uuid for update`,
    ),
    d.execute(
      assertSql(
        sql`coalesce(${bottleFingerprint(sql`${id}::uuid`)}=${expected},false)`,
        STALE_RECORD,
      ),
    ),
    ...(record.variantId !== stored.variantId
      ? [
          d.execute(
            assertSql(
              sql`exists(select 1 from perfume_variants where id=${record.variantId}::uuid and work_id=${stored.workId}::uuid)`,
              "A container can only move to another formulation of the same perfume",
            ),
          ),
        ]
      : []),
    ...supplierRole(d, record.supplierId),
    ...insertDates(d, [acquisition?.row, disposition?.row]),
    d
      .update(perfumeBottles)
      .set({
        ...bottleValues(record, {
          acquisitionDateId: acquisition
            ? (acquisition.row?.id ?? null)
            : stored.acquisitionDateId,
          dispositionDateId: disposition
            ? (disposition.row?.id ?? null)
            : stored.dispositionDateId,
        }),
        updatedAt: new Date(),
      })
      .where(eq(perfumeBottles.id, id)),
    ...releaseDates(d, [acquisition?.oldId, disposition?.oldId]),
  ]);
  changedHoldings();
  return (await getPerfumeBottle(id))!;
}

export async function deletePerfumeBottle(id: string) {
  z.uuid().parse(id);
  const bottle = await db.query.perfumeBottles.findFirst({
    where: eq(perfumeBottles.id, id),
    columns: { acquisitionDateId: true, dispositionDateId: true },
  });
  if (!bottle) throw new Error("Container not found");
  await write((d) => [
    d.delete(perfumeBottles).where(eq(perfumeBottles.id, id)),
    ...releaseDates(d, [bottle.acquisitionDateId, bottle.dispositionDateId]),
  ]);
  changedHoldings();
  return { id };
}
