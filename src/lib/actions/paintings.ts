"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import {
  works,
  paintingDetails,
  artObjects,
  artObjectCredits,
  artObjectTaxa,
  artObjectWhereabouts,
  artMovements,
  workArtMovements,
  customTaxonomyItemWorks,
  workCredits,
  publishingHouses,
  locations,
  subLocations,
  venues,
  comments,
  activityEvents,
  galleryLayouts,
} from "@/lib/db/schema";
import {
  ART_OBJECT_DEFAULTS,
  artObjectPatchSchema,
  artObjectRecordSchema,
  createPaintingSchema,
  paintingQuerySchema,
  updatePaintingSchema,
  type ArtObjectInput,
  type ArtObjectPatch,
  type CreatePaintingInput,
  type PaintingQuery,
  type UpdatePaintingInput,
} from "@/lib/validations/paintings";
import { fingerprintSchema } from "@/lib/validations/records";
import {
  insertArtMovements,
  insertObjectCredits,
  insertObjectTaxa,
  loadCurrentWhereabouts,
  loadObjectValues,
  loadPaintingCards,
  objectFingerprint,
  paintingCreationStart,
  paintingDomain,
  paintingFingerprint,
  paintingWhere,
  type CurrentWhereabouts,
} from "@/lib/catalogue/painting-store";
import { dateFromColumns } from "@/lib/catalogue/dates";
import { WHEREABOUTS_STALE_DAYS } from "@/lib/catalogue/paintings";
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
import { paintingHoldings } from "@/lib/catalogue/holdings";
import { assertSql, resultRows } from "@/lib/harmonization/store";
import { alphabeticalWorkIds } from "./utils/alphabetical-works";
import { getCreditRoles, getWorkCredits } from "./credits";
import { slugify } from "@/lib/utils/slugify";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { deleteUnusedObjects, workObjects } from "@/lib/s3/cleanup";

const lockWork = (d: Db, workId: string) =>
  lockAnyWork(d, workId, "painting");

/** Every write is one transaction; database rule messages reach the caller as written. */
function write(build: Parameters<typeof atomic>[0]) {
  return withReadableErrors(() => atomic(build), {
    unique: "Another object of this painting has this label, or this institution already uses this accession number",
  });
}
function changedCatalogue() {
  invalidate(
    CACHE_TAGS.works,
    CACHE_TAGS.authors,
    CACHE_TAGS.customTaxonomyItems,
    CACHE_TAGS.artMovements,
  );
}
function fresh(expected: string) {
  return (actual: string | null) => {
    if (actual === null) throw new Error("Record not found");
    if (actual !== expected) throw new Error(STALE_RECORD);
  };
}
async function paintingCreditRoles(credits: { roleId: string }[]) {
  const roles = new Set((await getCreditRoles("painting")).map((r) => r.id));
  if (credits.some((credit) => !roles.has(credit.roleId)))
    throw new Error("Contribution role does not apply to paintings");
}
function uniqueIdentity(
  workId: string,
  object: { kind: string; label: string | null },
  excludeId?: string,
) {
  return object.kind === "reproduction"
    ? []
    : [
        assertSql(
          sql`not exists(select 1 from art_objects where work_id=${workId}::uuid and kind<>'reproduction'
            and coalesce(label,'')=${object.label ?? ""}${excludeId ? sql` and id<>${excludeId}::uuid` : sql``})`,
          object.label
            ? "This painting already has an original or version with this label"
            : "Label each original or version when the painting has more than one",
        ),
      ];
}
function uniqueAccession(
  object: { ownerOrganizationId: string | null; accessionNumber: string | null },
  excludeId?: string,
) {
  return object.accessionNumber && object.ownerOrganizationId
    ? [
        assertSql(
          sql`not exists(select 1 from art_objects where owner_organization_id=${object.ownerOrganizationId}::uuid
            and lower(btrim(accession_number))=lower(btrim(${object.accessionNumber}))${excludeId ? sql` and id<>${excludeId}::uuid` : sql``})`,
          "This institution already uses this accession number",
        ),
      ]
    : [];
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getPaintings(input: PaintingQuery = {}) {
  const q = paintingQuerySchema.parse(input);
  const where = paintingWhere(q);
  let ids: string[];
  if (q.sort === "title")
    ids = await alphabeticalWorkIds(
      where,
      q.limit,
      q.offset,
      q.order ?? "asc",
      paintingDomain,
    );
  else {
    const direction = q.order ?? "desc";
    const key =
      q.sort === "created"
        ? paintingCreationStart
        : q.sort === "rating"
          ? sql`${works.rating}`
          : sql`${works.createdAt}`;
    const rows = await db
      .select({ id: works.id })
      .from(works)
      .where(and(paintingDomain, where))
      .orderBy(
        direction === "asc"
          ? sql`${key} asc nulls last`
          : sql`${key} desc nulls last`,
        asc(works.id),
      )
      .limit(q.limit)
      .offset(q.offset);
    ids = rows.map((row) => row.id);
  }
  return loadPaintingCards(ids);
}
export async function getPaintingCount(input: PaintingQuery = {}) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(works)
    .where(and(paintingDomain, paintingWhere(paintingQuerySchema.parse(input))));
  return row.count;
}

/** Current location with its age; a long-unchecked location is flagged as stale. */
function currentLocation(row: CurrentWhereabouts | undefined) {
  if (!row) return null;
  const { since, checkedAt, ...rest } = row;
  const ageDays = Math.max(
    0,
    Math.floor((Date.now() - new Date(checkedAt).getTime()) / 86400000),
  );
  return {
    ...rest,
    since: since ? dateFromColumns(since) : null,
    checkedAt: new Date(checkedAt),
    ageDays,
    isStale: ageDays >= WHEREABOUTS_STALE_DAYS,
  };
}
async function loadObjects(workId: string, ids?: string[]) {
  const rows = await db
    .select({
      object: artObjects,
      ownerName: publishingHouses.name,
      ownerSlug: publishingHouses.slug,
      locationName: locations.name,
      subLocationName: subLocations.name,
      venueName: venues.name,
      fingerprint: sql<string>`${objectFingerprint(sql`${artObjects.id}`)}`,
    })
    .from(artObjects)
    .leftJoin(
      publishingHouses,
      eq(artObjects.ownerOrganizationId, publishingHouses.id),
    )
    .leftJoin(locations, eq(artObjects.locationId, locations.id))
    .leftJoin(subLocations, eq(artObjects.subLocationId, subLocations.id))
    .leftJoin(venues, eq(artObjects.venueId, venues.id))
    .where(
      and(
        eq(artObjects.workId, workId),
        ids ? inArray(artObjects.id, ids) : undefined,
      ),
    )
    .orderBy(
      sql`case ${artObjects.kind} when 'original' then 0 when 'version' then 1 else 2 end`,
      asc(artObjects.createdAt),
      asc(artObjects.id),
    );
  if (!rows.length) return [];
  const [dates, values, current] = await Promise.all([
    loadDates(
      rows.flatMap(({ object }) => [
        object.creationDateId,
        object.acquisitionDateId,
        object.dispositionDateId,
      ]),
    ),
    loadObjectValues(
      workId,
      rows.map(({ object }) => object),
    ),
    loadCurrentWhereabouts(rows.map(({ object }) => object.id)),
  ]);
  return rows.map(({ object, ...rest }) => ({
    ...object,
    ...rest,
    creationDate: storedDate(dates, object.creationDateId),
    acquisitionDate: storedDate(dates, object.acquisitionDateId),
    dispositionDate: storedDate(dates, object.dispositionDateId),
    ...values.get(object.id)!,
    currentWhereabouts: currentLocation(current.get(object.id)),
  }));
}

/** The whole painting: identity, painters, classification and every object. */
export async function getPainting(idOrSlug: string) {
  z.string().min(1).max(1000).parse(idOrSlug);
  const byId = z.uuid().safeParse(idOrSlug).success;
  const [root] = await db
    .select({ work: works, details: paintingDetails })
    .from(works)
    .innerJoin(paintingDetails, eq(paintingDetails.workId, works.id))
    .where(
      and(
        eq(works.kind, "painting"),
        byId ? eq(works.id, idOrSlug) : eq(works.slug, idOrSlug),
      ),
    )
    .limit(1);
  if (!root) return null;
  const id = root.work.id;
  const [dates, credits, classification, movements, objects, fingerprint] =
    await Promise.all([
      loadDates([root.details.creationDateId]),
      getWorkCredits(id),
      db.execute(sql`select i.id as "itemId",i.name,i.slug,f.id as "familyId",f.slug as "familySlug"
        from custom_taxonomy_item_works t join custom_taxonomy_items i on i.id=t.item_id join taxonomy_families f on f.id=i.family_id
        where t.work_id=${id}::uuid order by f.slug,i.name,i.id`),
      db
        .select({ id: artMovements.id, name: artMovements.name, slug: artMovements.slug })
        .from(workArtMovements)
        .innerJoin(artMovements, eq(workArtMovements.artMovementId, artMovements.id))
        .where(eq(workArtMovements.workId, id))
        .orderBy(asc(artMovements.name), asc(artMovements.id)),
      loadObjects(id),
      readFingerprint(paintingFingerprint(id)),
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
    creationDate: storedDate(dates, root.details.creationDateId),
    sourceRecordId: root.details.sourceRecordId,
    credits,
    classification: resultRows<{
      itemId: string;
      name: string;
      slug: string;
      familyId: string;
      familySlug: string;
    }>(classification),
    artMovements: movements,
    objects,
    holdings: paintingHoldings(
      objects.map((o) =>
        o.ownership === "personal"
          ? {
              id: o.id,
              ownership: "personal" as const,
              objectKind: o.kind,
              status: o.holdingStatus!,
            }
          : { id: o.id, ownership: o.ownership, objectKind: o.kind },
      ),
    ),
    fingerprint: fingerprint!,
  };
}
export async function getArtObject(id: string) {
  z.uuid().parse(id);
  const row = await db.query.artObjects.findFirst({
    where: eq(artObjects.id, id),
    columns: { workId: true },
  });
  if (!row) return null;
  return (await loadObjects(row.workId, [id]))[0] ?? null;
}

// ── Painting writes ──────────────────────────────────────────────────────────

/** One transaction writes the painting and every section; no object is required. */
export async function createPainting(input: CreatePaintingInput) {
  const v = createPaintingSchema.parse(input);
  await paintingCreditRoles(v.credits);
  if (v.credits.some((credit) => credit.id))
    throw new Error("A new painting has no existing credits");
  const id = randomUUID();
  const creation = newDate(v.creationDate);
  await write((d) => [
    d.insert(works).values({
      id,
      kind: "painting",
      title: v.title,
      slug: `${slugify(v.title) || "painting"}-${id}`,
      description: v.description || null,
      originalLanguage: null,
    }),
    ...insertDates(d, [creation]),
    d.insert(paintingDetails).values({
      workId: id,
      creationDateId: creation?.id ?? null,
    }),
    ...insertWorkTaxa(d, id, v.classificationItemIds),
    ...insertArtMovements(d, id, v.artMovementIds),
    ...insertCredits(d, id, v.credits, []),
  ]);
  changedCatalogue();
  return (await getPainting(id))!;
}

/**
 * Each supplied section replaces that section in one transaction. Omitted
 * sections, objects, personal curation and source observations stay unchanged.
 */
export async function updatePainting(
  id: string,
  input: UpdatePaintingInput,
  fingerprint: string,
) {
  z.uuid().parse(id);
  const v = updatePaintingSchema.parse(input);
  const expected = fingerprintSchema.parse(fingerprint);
  const details = await db.query.paintingDetails.findFirst({
    where: eq(paintingDetails.workId, id),
  });
  fresh(expected)(
    details ? await readFingerprint(paintingFingerprint(id)) : null,
  );
  if (v.credits) await paintingCreditRoles(v.credits);
  const existingCredits = await db
    .select({ id: workCredits.id, createdAt: workCredits.createdAt })
    .from(workCredits)
    .where(eq(workCredits.workId, id));
  if (v.credits) requireOwnIds(v.credits, existingCredits, "credit");
  const dates = await loadDates([details!.creationDateId]);
  const creation = replaceDate(
    storedDate(dates, details!.creationDateId),
    v.creationDate,
  );
  const profile = {
    ...(creation && { creationDateId: creation.row?.id ?? null }),
    ...(v.sourceRecordId !== undefined && { sourceRecordId: v.sourceRecordId }),
  };
  await write((d) => [
    lockWork(d, id),
    d.execute(
      assertSql(
        sql`coalesce(${paintingFingerprint(id)}=${expected},false)`,
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
      .where(and(eq(works.id, id), eq(works.kind, "painting"))),
    ...insertDates(d, [creation?.row]),
    ...(Object.keys(profile).length
      ? [
          d
            .update(paintingDetails)
            .set(profile)
            .where(eq(paintingDetails.workId, id)),
        ]
      : []),
    ...releaseDates(d, [creation?.oldId]),
    ...(v.classificationItemIds
      ? [
          d
            .delete(customTaxonomyItemWorks)
            .where(eq(customTaxonomyItemWorks.workId, id)),
          ...insertWorkTaxa(d, id, v.classificationItemIds),
        ]
      : []),
    ...(v.artMovementIds
      ? [
          d.delete(workArtMovements).where(eq(workArtMovements.workId, id)),
          ...insertArtMovements(d, id, v.artMovementIds),
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
  return (await getPainting(id))!;
}

/**
 * Personally owned objects protect a painting. Its other objects, comments,
 * activity and layouts go in the same transaction; artwork after commit.
 */
export async function deletePainting(id: string) {
  z.uuid().parse(id);
  const details = await db.query.paintingDetails.findFirst({
    where: eq(paintingDetails.workId, id),
  });
  if (!details) throw new Error("Painting not found");
  const [objectDates, locationDates, stored] = await Promise.all([
    db
      .select({ id: artObjects.creationDateId })
      .from(artObjects)
      .where(eq(artObjects.workId, id)),
    db
      .select({
        starts: artObjectWhereabouts.startsOnId,
        ends: artObjectWhereabouts.endsOnId,
      })
      .from(artObjectWhereabouts)
      .innerJoin(artObjects, eq(artObjectWhereabouts.objectId, artObjects.id))
      .where(eq(artObjects.workId, id)),
    // Read the file keys first: the cascade removes the rows that name them.
    workObjects(id),
  ]);
  const owner = (
    table: typeof comments | typeof activityEvents | typeof galleryLayouts,
  ) => and(eq(table.entityType, "work"), eq(table.entityId, id));
  await write((d) => [
    lockWork(d, id),
    d.execute(
      assertSql(
        sql`exists(select 1 from works where id=${id}::uuid and kind='painting')`,
        "Painting not found",
      ),
    ),
    d.execute(
      assertSql(
        sql`not exists(select 1 from art_objects where work_id=${id}::uuid and ownership='personal')`,
        "Delete or reassign the objects you own of this painting first",
      ),
    ),
    d.delete(comments).where(owner(comments)),
    d.delete(activityEvents).where(owner(activityEvents)),
    d.delete(galleryLayouts).where(owner(galleryLayouts)),
    // Reproductions refer to originals of the same painting: remove them first.
    d
      .delete(artObjects)
      .where(and(eq(artObjects.workId, id), eq(artObjects.kind, "reproduction"))),
    d.delete(works).where(and(eq(works.id, id), eq(works.kind, "painting"))),
    ...releaseDates(d, [
      details.creationDateId,
      ...objectDates.map((row) => row.id),
      ...locationDates.flatMap((row) => [row.starts, row.ends]),
    ]),
  ]);
  changedCatalogue();
  invalidate(CACHE_TAGS.media, CACHE_TAGS.comments, CACHE_TAGS.activity);
  const cleanupPending = await deleteUnusedObjects(stored, `painting ${id}`);
  return { id, cleanupPending };
}

// ── Object writes ────────────────────────────────────────────────────────────

type ObjectRecord = ReturnType<typeof artObjectRecordSchema.parse>;
function objectValues(
  record: ObjectRecord,
  dates: {
    creationDateId: string | null;
    acquisitionDateId: string | null;
    dispositionDateId: string | null;
  },
) {
  const {
    creationDate: _creation,
    acquisitionDate: _acquisition,
    dispositionDate: _disposition,
    attribution,
    classificationItemIds: _taxa,
    ...fields
  } = record;
  return { ...fields, ...dates, attributionOverride: attribution !== null };
}
/** Object taxa must use families that apply to painting objects. */
function objectTaxaCheck(itemIds: string[]) {
  return itemIds.length
    ? [
        assertSql(
          sql`(select count(*) from custom_taxonomy_items i join taxonomy_applicability a on a.family_id=i.family_id
            where a.kind='painting' and a.level='art_object' and i.id in (${sql.join(
              itemIds.map((item) => sql`${item}::uuid`),
              sql`,`,
            )}))=${itemIds.length}`,
          "Technique, medium or support: this classification does not apply to painting objects",
        ),
      ]
    : [];
}

export async function createArtObject(input: ArtObjectInput) {
  const { workId, ...fields } = input;
  z.uuid().parse(workId);
  const record = artObjectRecordSchema.parse({
    ...ART_OBJECT_DEFAULTS,
    ...supplied(artObjectPatchSchema.parse(fields)),
  });
  const id = randomUUID();
  const creation = newDate(record.creationDate),
    acquisition = newDate(record.acquisitionDate),
    disposition = newDate(record.dispositionDate);
  await write((d) => [
    lockWork(d, workId),
    d.execute(
      assertSql(
        sql`exists(select 1 from painting_details where work_id=${workId}::uuid)`,
        "Painting not found",
      ),
    ),
    ...uniqueIdentity(workId, record).map((check) => d.execute(check)),
    ...uniqueAccession(record).map((check) => d.execute(check)),
    ...objectTaxaCheck(record.classificationItemIds).map((check) =>
      d.execute(check),
    ),
    ...insertDates(d, [creation, acquisition, disposition]),
    d.insert(artObjects).values({
      id,
      workId,
      ...objectValues(record, {
        creationDateId: creation?.id ?? null,
        acquisitionDateId: acquisition?.id ?? null,
        dispositionDateId: disposition?.id ?? null,
      }),
    }),
    ...insertObjectCredits(d, id, record.attribution ?? []),
    ...insertObjectTaxa(d, id, record.classificationItemIds),
  ]);
  changedCatalogue();
  return (await getArtObject(id))!;
}

/**
 * The patch is merged with the stored object and validated as a whole, so
 * ownership, dimension and holding rules hold for the result. `attribution:
 * null` restores the painting's painters.
 */
export async function updateArtObject(
  id: string,
  input: ArtObjectPatch,
  fingerprint: string,
) {
  z.uuid().parse(id);
  const patch = supplied(artObjectPatchSchema.parse(input));
  const expected = fingerprintSchema.parse(fingerprint);
  const current = await getArtObject(id);
  fresh(expected)(current?.fingerprint ?? null);
  const stored = current!;
  const ownCredits = await db
    .select({ id: artObjectCredits.id })
    .from(artObjectCredits)
    .where(eq(artObjectCredits.objectId, id));
  const record = artObjectRecordSchema.parse({
    kind: stored.kind,
    label: stored.label,
    reproducesObjectId: stored.reproducesObjectId,
    creationDate: stored.creationDate?.value ?? null,
    height: stored.height,
    width: stored.width,
    depth: stored.depth,
    dimensionUnit: stored.dimensionUnit,
    dimensionsNote: stored.dimensionsNote,
    attribution: stored.attributionOverride
      ? stored.attribution.map((c) => ({
          id: c.id,
          personId: c.personId,
          creditedAs: c.creditedAs,
          attribution: c.attribution,
        }))
      : null,
    classificationItemIds: stored.classification
      .filter((t) => !t.inherited)
      .map((t) => t.itemId),
    ownership: stored.ownership,
    ownerOrganizationId: stored.ownerOrganizationId,
    ownerLabel: stored.ownerLabel,
    collectionName: stored.collectionName,
    accessionNumber: stored.accessionNumber,
    holdingStatus: stored.holdingStatus,
    locationId: stored.locationId,
    subLocationId: stored.subLocationId,
    acquisitionDate: stored.acquisitionDate?.value ?? null,
    venueId: stored.venueId,
    acquisitionPrice: stored.acquisitionPrice,
    acquisitionCurrency: stored.acquisitionCurrency,
    dispositionDate: stored.dispositionDate?.value ?? null,
    dispositionReason: stored.dispositionReason,
    notes: stored.notes,
    sourceRecordId: stored.sourceRecordId,
    ...patch,
  });
  if (patch.attribution) requireOwnIds(patch.attribution, ownCredits, "credit");
  const creation = replaceDate(stored.creationDate, patch.creationDate);
  const acquisition = replaceDate(stored.acquisitionDate, patch.acquisitionDate);
  const disposition = replaceDate(stored.dispositionDate, patch.dispositionDate);
  const kept = (next: ReturnType<typeof replaceDate>, old: string | null) =>
    next ? (next.row?.id ?? null) : old;
  await write((d) => [
    lockWork(d, stored.workId),
    d.execute(sql`select id from art_objects where id=${id}::uuid for update`),
    d.execute(
      assertSql(
        sql`coalesce(${objectFingerprint(sql`${id}::uuid`)}=${expected},false)`,
        STALE_RECORD,
      ),
    ),
    ...uniqueIdentity(stored.workId, record, id).map((check) =>
      d.execute(check),
    ),
    ...uniqueAccession(record, id).map((check) => d.execute(check)),
    ...objectTaxaCheck(record.classificationItemIds).map((check) =>
      d.execute(check),
    ),
    ...insertDates(d, [creation?.row, acquisition?.row, disposition?.row]),
    // Attribution is removed before inheritance is restored, and the override
    // is declared before object credits are inserted.
    ...(patch.attribution !== undefined
      ? [d.delete(artObjectCredits).where(eq(artObjectCredits.objectId, id))]
      : []),
    d
      .update(artObjects)
      .set({
        ...objectValues(record, {
          creationDateId: kept(creation, stored.creationDateId),
          acquisitionDateId: kept(acquisition, stored.acquisitionDateId),
          dispositionDateId: kept(disposition, stored.dispositionDateId),
        }),
        updatedAt: new Date(),
      })
      .where(eq(artObjects.id, id)),
    ...(patch.attribution !== undefined
      ? insertObjectCredits(d, id, record.attribution ?? [])
      : []),
    ...(patch.classificationItemIds
      ? [
          d.delete(artObjectTaxa).where(eq(artObjectTaxa.objectId, id)),
          ...insertObjectTaxa(d, id, record.classificationItemIds),
        ]
      : []),
    ...releaseDates(d, [
      creation?.oldId,
      acquisition?.oldId,
      disposition?.oldId,
    ]),
  ]);
  changedCatalogue();
  return (await getArtObject(id))!;
}

/**
 * Reproductions that name an object protect it; delete or re-point them first.
 * The object's location history goes with it.
 */
export async function deleteArtObject(id: string) {
  z.uuid().parse(id);
  const object = await db.query.artObjects.findFirst({
    where: eq(artObjects.id, id),
  });
  if (!object) throw new Error("Object not found");
  const locationDates = await db
    .select({
      starts: artObjectWhereabouts.startsOnId,
      ends: artObjectWhereabouts.endsOnId,
    })
    .from(artObjectWhereabouts)
    .where(eq(artObjectWhereabouts.objectId, id));
  await write((d) => [
    lockWork(d, object.workId),
    d.execute(
      assertSql(
        sql`not exists(select 1 from art_objects where reproduces_object_id=${id}::uuid)`,
        "Reproductions refer to this object; change or delete them first",
      ),
    ),
    d.delete(artObjects).where(eq(artObjects.id, id)),
    ...releaseDates(d, [
      object.creationDateId,
      object.acquisitionDateId,
      object.dispositionDateId,
      ...locationDates.flatMap((row) => [row.starts, row.ends]),
    ]),
  ]);
  changedCatalogue();
  return { id };
}
