"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
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
import { alphabeticalWorkIds } from "./utils/alphabetical-works";
import { getCreditRoles, getWorkCredits } from "./credits";
import { getPerfumeRetailerLinks } from "./perfume-retailers";
import { slugify } from "@/lib/utils/slugify";
import { assertSql } from "@/lib/harmonization/store";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { deleteUnusedObjects, workObjects } from "@/lib/s3/cleanup";

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
  const [dates, overrides] = await Promise.all([
    loadDates(
      rows.flatMap(({ variant }) => [
        variant.releaseDateId,
        variant.discontinuedDateId,
      ]),
    ),
    db
      .select()
      .from(perfumeVariantOverrides)
      .where(
        inArray(
          perfumeVariantOverrides.variantId,
          rows.map(({ variant }) => variant.id),
        ),
      ),
  ]);
  // Effective values come from the shared inheritance queries, one pair per
  // formulation of this fragrance.
  return Promise.all(
    rows.map(async ({ variant, fingerprint }) => {
      const [classification, perfumers] = await Promise.all([
        loadPerfumeClassification(workId, variant.id),
        loadPerfumePerfumers(workId, variant.id),
      ]);
      return {
        ...variant,
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
  await write((d) => [
    d.insert(works).values({
      id,
      kind: "perfume",
      title: v.title,
      slug: `${slugify(v.title) || "perfume"}-${id}`,
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
  return { id };
}

// ── Container writes ─────────────────────────────────────────────────────────

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
