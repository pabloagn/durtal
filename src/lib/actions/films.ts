"use server";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import {
  works,
  filmDetails,
  filmCountries,
  filmLanguages,
  filmOrganizations,
  filmVersions,
  filmReleases,
  filmHoldings,
  countries,
  languages,
  customTaxonomyItemWorks,
  workCredits,
  publishingHouses,
  venues,
  locations,
  subLocations,
  media,
  comments,
  activityEvents,
  galleryLayouts,
} from "@/lib/db/schema";
import {
  createFilmSchema,
  createFilmVersionSchema,
  filmHoldingPatchSchema,
  filmHoldingRecordSchema,
  filmQuerySchema,
  FILM_HOLDING_DEFAULTS,
  updateFilmSchema,
  updateFilmVersionSchema,
  type CreateFilmInput,
  type CreateFilmVersionInput,
  type FilmHoldingInput,
  type FilmHoldingPatch,
  type FilmQuery,
  type UpdateFilmInput,
  type UpdateFilmVersionInput,
} from "@/lib/validations/films";
import { fingerprintSchema } from "@/lib/validations/records";
import {
  filmDomain,
  filmFingerprint,
  filmReleaseStart,
  filmWhere,
  holdingFingerprint,
  insertCountries,
  insertFilmOrganizations,
  insertLanguages,
  insertReleases,
  loadFilmCards,
  newReleases,
  primaryRuntime,
  releaseRow,
  versionFingerprint,
} from "@/lib/catalogue/film-store";
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
  uuids,
  type Db,
} from "@/lib/catalogue/work-store";
import { filmHoldings as summarizeFilmHoldings } from "@/lib/catalogue/holdings";
import { normalizeCatalogueDate } from "@/lib/catalogue/dates";
import { alphabeticalWorkIds } from "./utils/alphabetical-works";
import { getCreditRoles, getWorkCredits } from "./credits";
import { slugify } from "@/lib/utils/slugify";
import { assertSql, resultRows } from "@/lib/harmonization/store";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { cleanupWorkArtwork } from "@/lib/s3/artwork-cleanup";

const lockWork = (d: Db, workId: string) => lockAnyWork(d, workId, "film");

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
async function filmCreditRoles(credits: { roleId: string }[]) {
  const roles = new Set((await getCreditRoles("film")).map((r) => r.id));
  if (credits.some((credit) => !roles.has(credit.roleId)))
    throw new Error("Contribution role does not apply to films");
}
function uniqueLabel(workId: string, label: string | null, excludeId?: string) {
  return assertSql(
    sql`not exists(select 1 from film_versions where work_id=${workId}::uuid and label is not distinct from ${label}${
      excludeId ? sql` and id<>${excludeId}::uuid` : sql``
    })`,
    label
      ? "This film already has a version with this label"
      : "This film already has an unlabelled version",
  );
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getFilms(input: FilmQuery = {}) {
  const q = filmQuerySchema.parse(input);
  const where = filmWhere(q);
  let ids: string[];
  if (q.sort === "title")
    ids = await alphabeticalWorkIds(
      where,
      q.limit,
      q.offset,
      q.order ?? "asc",
      filmDomain,
    );
  else {
    const direction = q.order ?? "desc";
    const key =
      q.sort === "release"
        ? filmReleaseStart
        : q.sort === "runtime"
          ? primaryRuntime
          : q.sort === "rating"
            ? sql`${works.rating}`
            : sql`${works.createdAt}`;
    const rows = await db
      .select({ id: works.id })
      .from(works)
      .where(and(filmDomain, where))
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
  return loadFilmCards(ids);
}
export async function getFilmCount(input: FilmQuery = {}) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(works)
    .where(and(filmDomain, filmWhere(filmQuerySchema.parse(input))));
  return row.count;
}

async function loadVersions(workId: string, ids?: string[]) {
  const rows = await db
    .select({
      version: filmVersions,
      fingerprint: sql<string>`${versionFingerprint(sql`${filmVersions.id}`)}`,
    })
    .from(filmVersions)
    .where(
      and(
        eq(filmVersions.workId, workId),
        ids ? inArray(filmVersions.id, ids) : undefined,
      ),
    )
    .orderBy(asc(filmVersions.sortOrder), asc(filmVersions.id));
  if (!rows.length) return [];
  const releases = await db
    .select({
      release: filmReleases,
      countryName: countries.name,
      countryCode: countries.alpha2,
      distributorName: publishingHouses.name,
    })
    .from(filmReleases)
    .leftJoin(countries, eq(filmReleases.countryId, countries.id))
    .leftJoin(publishingHouses, eq(filmReleases.distributorId, publishingHouses.id))
    .where(
      inArray(
        filmReleases.versionId,
        rows.map(({ version }) => version.id),
      ),
    )
    .orderBy(asc(filmReleases.createdAt), asc(filmReleases.id));
  const dates = await loadDates(
    releases.map(({ release }) => release.releaseDateId),
  );
  // Releases order by date where known; undated releases follow in entry order.
  const start = (row: (typeof releases)[number]) => {
    const value = row.release.releaseDateId
      ? dates.get(row.release.releaseDateId)
      : undefined;
    return value ? normalizeCatalogueDate(value).lowerBound : null;
  };
  const byDate = (a: (typeof releases)[number], b: (typeof releases)[number]) => {
    const x = start(a),
      y = start(b);
    return x === y ? 0 : x === null ? 1 : y === null ? -1 : x - y;
  };
  return rows.map(({ version, fingerprint }) => ({
    ...version,
    releases: releases
      .filter(({ release }) => release.versionId === version.id)
      .sort(byDate)
      .map(({ release, ...names }) => ({
        ...release,
        ...names,
        releaseDate: storedDate(dates, release.releaseDateId),
      })),
    fingerprint,
  }));
}
async function loadHoldings(where: ReturnType<typeof eq>) {
  const rows = await db
    .select({
      holding: filmHoldings,
      versionLabel: filmVersions.label,
      locationName: locations.name,
      subLocationName: subLocations.name,
      supplierName: publishingHouses.name,
      venueName: venues.name,
      fingerprint: sql<string>`${holdingFingerprint(sql`${filmHoldings.id}`)}`,
    })
    .from(filmHoldings)
    .leftJoin(filmVersions, eq(filmHoldings.versionId, filmVersions.id))
    .leftJoin(locations, eq(filmHoldings.locationId, locations.id))
    .leftJoin(subLocations, eq(filmHoldings.subLocationId, subLocations.id))
    .leftJoin(publishingHouses, eq(filmHoldings.supplierId, publishingHouses.id))
    .leftJoin(venues, eq(filmHoldings.venueId, venues.id))
    .where(where)
    .orderBy(asc(filmHoldings.createdAt), asc(filmHoldings.id));
  const dates = await loadDates(
    rows.flatMap(({ holding }) => [
      holding.acquisitionDateId,
      holding.dispositionDateId,
    ]),
  );
  return rows.map(({ holding, ...rest }) => ({
    ...holding,
    ...rest,
    acquisitionDate: storedDate(dates, holding.acquisitionDateId),
    dispositionDate: storedDate(dates, holding.dispositionDateId),
  }));
}

/** The whole film: identity, cast and crew, versions with releases, and copies. */
export async function getFilm(idOrSlug: string) {
  z.string().min(1).max(1000).parse(idOrSlug);
  const byId = z.uuid().safeParse(idOrSlug).success;
  const [root] = await db
    .select({ work: works, details: filmDetails })
    .from(works)
    .innerJoin(filmDetails, eq(filmDetails.workId, works.id))
    .where(
      and(
        eq(works.kind, "film"),
        byId ? eq(works.id, idOrSlug) : eq(works.slug, idOrSlug),
      ),
    )
    .limit(1);
  if (!root) return null;
  const id = root.work.id;
  const [
    dates,
    filmCountryRows,
    filmLanguageRows,
    organizations,
    credits,
    classification,
    versions,
    holdings,
    fingerprint,
  ] = await Promise.all([
    loadDates([root.details.releaseDateId]),
    db
      .select({ id: countries.id, name: countries.name, alpha2: countries.alpha2 })
      .from(filmCountries)
      .innerJoin(countries, eq(filmCountries.countryId, countries.id))
      .where(eq(filmCountries.workId, id))
      .orderBy(asc(filmCountries.sortOrder), asc(countries.id)),
    db
      .select({ id: languages.id, name: languages.name, code: languages.iso6391 })
      .from(filmLanguages)
      .innerJoin(languages, eq(filmLanguages.languageId, languages.id))
      .where(eq(filmLanguages.workId, id))
      .orderBy(asc(filmLanguages.sortOrder), asc(languages.id)),
    db
      .select({
        organizationId: filmOrganizations.organizationId,
        name: publishingHouses.name,
        slug: publishingHouses.slug,
        role: filmOrganizations.role,
        sortOrder: filmOrganizations.sortOrder,
        sourceRecordId: filmOrganizations.sourceRecordId,
      })
      .from(filmOrganizations)
      .innerJoin(
        publishingHouses,
        eq(filmOrganizations.organizationId, publishingHouses.id),
      )
      .where(eq(filmOrganizations.workId, id))
      .orderBy(
        asc(filmOrganizations.role),
        asc(filmOrganizations.sortOrder),
        asc(filmOrganizations.organizationId),
      ),
    getWorkCredits(id),
    db.execute(sql`select i.id as "itemId",i.name,i.slug,f.id as "familyId",f.slug as "familySlug"
      from custom_taxonomy_item_works t join custom_taxonomy_items i on i.id=t.item_id join taxonomy_families f on f.id=i.family_id
      where t.work_id=${id}::uuid order by f.slug,i.name,i.id`),
    loadVersions(id),
    loadHoldings(eq(filmHoldings.workId, id)),
    readFingerprint(filmFingerprint(id)),
  ]);
  const { work } = root;
  return {
    id,
    slug: work.slug,
    title: work.title,
    originalTitle: root.details.originalTitle,
    description: work.description,
    curation: {
      notes: work.notes,
      rating: work.rating,
      isFavourite: work.isFavourite,
    },
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    releaseDate: storedDate(dates, root.details.releaseDateId),
    sourceRecordId: root.details.sourceRecordId,
    countries: filmCountryRows,
    languages: filmLanguageRows,
    organizations,
    credits,
    classification: resultRows<{
      itemId: string;
      name: string;
      slug: string;
      familyId: string;
      familySlug: string;
    }>(classification),
    versions,
    holdings,
    holdingsSummary: summarizeFilmHoldings(
      holdings.map((h) => ({ id: h.id, status: h.status, medium: h.medium })),
    ),
    fingerprint: fingerprint!,
  };
}
export async function getFilmVersion(id: string) {
  z.uuid().parse(id);
  const row = await db.query.filmVersions.findFirst({
    where: eq(filmVersions.id, id),
    columns: { workId: true },
  });
  if (!row) return null;
  return (await loadVersions(row.workId, [id]))[0] ?? null;
}
export async function getFilmHolding(id: string) {
  z.uuid().parse(id);
  return (await loadHoldings(eq(filmHoldings.id, id)))[0] ?? null;
}

// ── Film writes ──────────────────────────────────────────────────────────────

/** One transaction writes the film and every section. A remake is a new film. */
export async function createFilm(input: CreateFilmInput) {
  const v = createFilmSchema.parse(input);
  await filmCreditRoles(v.credits);
  if (v.credits.some((credit) => credit.id))
    throw new Error("A new film has no existing credits");
  const id = randomUUID();
  const release = newDate(v.releaseDate);
  await write((d) => [
    d.insert(works).values({
      id,
      kind: "film",
      title: v.title,
      slug: `${slugify(v.title) || "film"}-${id}`,
      description: v.description || null,
      originalLanguage: null,
    }),
    ...insertDates(d, [release]),
    d.insert(filmDetails).values({
      workId: id,
      originalTitle: v.originalTitle,
      releaseDateId: release?.id ?? null,
    }),
    ...insertCountries(d, id, v.countryIds),
    ...insertLanguages(d, id, v.languageIds),
    ...insertFilmOrganizations(d, id, v.organizations),
    ...insertWorkTaxa(d, id, v.classificationItemIds),
    ...insertCredits(d, id, v.credits, []),
  ]);
  changedCatalogue();
  return (await getFilm(id))!;
}

/**
 * Each supplied section replaces that section in one transaction. Omitted
 * sections, personal curation and source observations are never touched.
 */
export async function updateFilm(
  id: string,
  input: UpdateFilmInput,
  fingerprint: string,
) {
  z.uuid().parse(id);
  const v = updateFilmSchema.parse(input);
  const expected = fingerprintSchema.parse(fingerprint);
  const details = await db.query.filmDetails.findFirst({
    where: eq(filmDetails.workId, id),
  });
  fresh(expected)(details ? await readFingerprint(filmFingerprint(id)) : null);
  if (v.credits) await filmCreditRoles(v.credits);
  const existingCredits = await db
    .select({ id: workCredits.id, createdAt: workCredits.createdAt })
    .from(workCredits)
    .where(eq(workCredits.workId, id));
  if (v.credits) requireOwnIds(v.credits, existingCredits, "credit");
  if (v.versionOrder) {
    const current = await db
      .select({ id: filmVersions.id })
      .from(filmVersions)
      .where(eq(filmVersions.workId, id));
    const known = new Set(current.map((row) => row.id));
    if (
      v.versionOrder.length !== known.size ||
      v.versionOrder.some((versionId) => !known.has(versionId))
    )
      throw new Error("List every version of this film once");
  }
  const dates = await loadDates([details!.releaseDateId]);
  const release = replaceDate(
    storedDate(dates, details!.releaseDateId),
    v.releaseDate,
  );
  const profile = {
    ...(v.originalTitle !== undefined && { originalTitle: v.originalTitle }),
    ...(release && { releaseDateId: release.row?.id ?? null }),
    ...(v.sourceRecordId !== undefined && { sourceRecordId: v.sourceRecordId }),
  };
  await write((d) => [
    lockWork(d, id),
    d.execute(
      assertSql(
        sql`coalesce(${filmFingerprint(id)}=${expected},false)`,
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
      .where(and(eq(works.id, id), eq(works.kind, "film"))),
    ...insertDates(d, [release?.row]),
    ...(Object.keys(profile).length
      ? [d.update(filmDetails).set(profile).where(eq(filmDetails.workId, id))]
      : []),
    ...releaseDates(d, [release?.oldId]),
    ...(v.countryIds
      ? [
          d.delete(filmCountries).where(eq(filmCountries.workId, id)),
          ...insertCountries(d, id, v.countryIds),
        ]
      : []),
    ...(v.languageIds
      ? [
          d.delete(filmLanguages).where(eq(filmLanguages.workId, id)),
          ...insertLanguages(d, id, v.languageIds),
        ]
      : []),
    ...(v.organizations
      ? [
          d.delete(filmOrganizations).where(eq(filmOrganizations.workId, id)),
          ...insertFilmOrganizations(d, id, v.organizations),
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
    ...(v.versionOrder
      ? [
          d.execute(
            assertSql(
              sql`(select count(*) from film_versions where work_id=${id}::uuid)=${v.versionOrder.length}
                and not exists(select 1 from film_versions where work_id=${id}::uuid${
                  v.versionOrder.length
                    ? sql` and id not in (${uuids(v.versionOrder)})`
                    : sql``
                })`,
              "List every version of this film once",
            ),
          ),
        ]
      : []),
    ...(v.versionOrder?.length
      ? [
          d.execute(
            sql`update film_versions v set sort_order=o.position from (values ${sql.join(
              v.versionOrder.map(
                (versionId, position) => sql`(${versionId}::uuid,${position}::int)`,
              ),
              sql`,`,
            )}) as o(id,position) where v.id=o.id and v.work_id=${id}::uuid`,
          ),
        ]
      : []),
  ]);
  changedCatalogue();
  return (await getFilm(id))!;
}

/**
 * Personal copies protect a film. Comments, activity and layouts go in the
 * same transaction; its artwork is removed after commit.
 */
export async function deleteFilm(id: string) {
  z.uuid().parse(id);
  const details = await db.query.filmDetails.findFirst({
    where: eq(filmDetails.workId, id),
  });
  if (!details) throw new Error("Film not found");
  const [releaseDateRows, artwork] = await Promise.all([
    db
      .select({ id: filmReleases.releaseDateId })
      .from(filmReleases)
      .innerJoin(filmVersions, eq(filmReleases.versionId, filmVersions.id))
      .where(eq(filmVersions.workId, id)),
    db
      .select({
        s3Key: media.s3Key,
        thumbnailS3Key: media.thumbnailS3Key,
        originalS3Key: media.originalS3Key,
      })
      .from(media)
      .where(eq(media.workId, id)),
  ]);
  const owner = (
    table: typeof comments | typeof activityEvents | typeof galleryLayouts,
  ) => and(eq(table.entityType, "work"), eq(table.entityId, id));
  await write((d) => [
    lockWork(d, id),
    d.execute(
      assertSql(
        sql`exists(select 1 from works where id=${id}::uuid and kind='film')`,
        "Film not found",
      ),
    ),
    d.execute(
      assertSql(
        sql`not exists(select 1 from film_holdings where work_id=${id}::uuid)`,
        "Delete or move this film's personal copies first",
      ),
    ),
    d.delete(comments).where(owner(comments)),
    d.delete(activityEvents).where(owner(activityEvents)),
    d.delete(galleryLayouts).where(owner(galleryLayouts)),
    d.delete(works).where(and(eq(works.id, id), eq(works.kind, "film"))),
    ...releaseDates(d, [
      details.releaseDateId,
      ...releaseDateRows.map((row) => row.id),
    ]),
  ]);
  changedCatalogue();
  invalidate(CACHE_TAGS.media, CACHE_TAGS.comments, CACHE_TAGS.activity);
  const cleanupPending = await cleanupWorkArtwork(
    id,
    artwork.flatMap((m) =>
      [m.s3Key, m.thumbnailS3Key, m.originalS3Key].filter(
        (key): key is string => !!key,
      ),
    ),
  );
  return { id, cleanupPending };
}

// ── Version writes ───────────────────────────────────────────────────────────

/** A cut or version with its releases, appended after the existing versions. */
export async function createFilmVersion(input: CreateFilmVersionInput) {
  const v = createFilmVersionSchema.parse(input);
  const id = randomUUID();
  const releases = newReleases(id, v.releases);
  await write((d) => [
    lockWork(d, v.workId),
    d.execute(
      assertSql(
        sql`exists(select 1 from film_details where work_id=${v.workId}::uuid)`,
        "Film not found",
      ),
    ),
    d.execute(uniqueLabel(v.workId, v.label)),
    ...insertDates(
      d,
      releases.map((r) => r.date),
    ),
    d.insert(filmVersions).values({
      id,
      workId: v.workId,
      label: v.label,
      runtimeSeconds: v.runtimeSeconds,
      notes: v.notes,
      sourceRecordId: v.sourceRecordId,
      sortOrder: sql`(select coalesce(max(sort_order)+1,0) from film_versions where work_id=${v.workId}::uuid)`,
    }),
    ...insertReleases(
      d,
      releases.map((r) => r.row),
    ),
  ]);
  changedCatalogue();
  return (await getFilmVersion(id))!;
}

/**
 * Supplied fields replace the version's values. A supplied release list
 * replaces its releases: listed IDs are kept and updated in place, new entries
 * are added and missing ones removed, unless a personal copy names them.
 */
export async function updateFilmVersion(
  id: string,
  input: UpdateFilmVersionInput,
  fingerprint: string,
) {
  z.uuid().parse(id);
  const v = updateFilmVersionSchema.parse(input);
  const expected = fingerprintSchema.parse(fingerprint);
  const current = await db.query.filmVersions.findFirst({
    where: eq(filmVersions.id, id),
  });
  fresh(expected)(
    current ? await readFingerprint(versionFingerprint(sql`${id}::uuid`)) : null,
  );
  const version = current!;
  const existing = v.releases
    ? await db.select().from(filmReleases).where(eq(filmReleases.versionId, id))
    : [];
  if (v.releases) requireOwnIds(v.releases, existing, "release");
  const dates = await loadDates(existing.map((r) => r.releaseDateId));
  const keptIds = new Set(v.releases?.flatMap((r) => (r.id ? [r.id] : [])));
  const removed = existing.filter((r) => !keptIds.has(r.id));
  const kept = (v.releases ?? [])
    .filter((r) => r.id)
    .map((release) => {
      const stored = existing.find((r) => r.id === release.id)!;
      const date = replaceDate(
        storedDate(dates, stored.releaseDateId),
        release.releaseDate,
      );
      return {
        release,
        date,
        row: releaseRow(
          id,
          release,
          date ? (date.row?.id ?? null) : stored.releaseDateId,
        ),
      };
    });
  const added = newReleases(
    id,
    (v.releases ?? []).filter((r) => !r.id),
  );
  const label = v.label !== undefined ? v.label : version.label;
  await write((d) => [
    lockWork(d, version.workId),
    d.execute(sql`select id from film_versions where id=${id}::uuid for update`),
    d.execute(
      assertSql(
        sql`coalesce(${versionFingerprint(sql`${id}::uuid`)}=${expected},false)`,
        STALE_RECORD,
      ),
    ),
    d.execute(uniqueLabel(version.workId, label, id)),
    d
      .update(filmVersions)
      .set({
        label,
        ...(v.runtimeSeconds !== undefined && {
          runtimeSeconds: v.runtimeSeconds,
        }),
        ...(v.notes !== undefined && { notes: v.notes }),
        ...(v.sourceRecordId !== undefined && {
          sourceRecordId: v.sourceRecordId,
        }),
        updatedAt: new Date(),
      })
      .where(eq(filmVersions.id, id)),
    ...(removed.length
      ? [
          d.execute(
            assertSql(
              sql`not exists(select 1 from film_holdings where release_id in (${uuids(removed.map((r) => r.id))}))`,
              "A personal copy names a release you removed; change the copy first",
            ),
          ),
          d.delete(filmReleases).where(
            inArray(
              filmReleases.id,
              removed.map((r) => r.id),
            ),
          ),
        ]
      : []),
    ...insertDates(d, [
      ...kept.map((k) => k.date?.row),
      ...added.map((a) => a.date),
    ]),
    ...kept.map((k) =>
      d.update(filmReleases).set(k.row).where(eq(filmReleases.id, k.release.id!)),
    ),
    ...insertReleases(
      d,
      added.map((a) => a.row),
    ),
    ...releaseDates(d, [
      ...removed.map((r) => r.releaseDateId),
      ...kept.map((k) => k.date?.oldId),
    ]),
  ]);
  changedCatalogue();
  return (await getFilmVersion(id))!;
}

export async function deleteFilmVersion(id: string) {
  z.uuid().parse(id);
  const version = await db.query.filmVersions.findFirst({
    where: eq(filmVersions.id, id),
  });
  if (!version) throw new Error("Version not found");
  const releaseDateRows = await db
    .select({ id: filmReleases.releaseDateId })
    .from(filmReleases)
    .where(eq(filmReleases.versionId, id));
  await write((d) => [
    lockWork(d, version.workId),
    d.execute(sql`select id from film_versions where id=${id}::uuid for update`),
    d.execute(
      assertSql(
        sql`not exists(select 1 from film_holdings h where h.version_id=${id}::uuid
          or h.release_id in (select r.id from film_releases r where r.version_id=${id}::uuid))`,
        "Delete or move the personal copies of this version first",
      ),
    ),
    d.delete(filmVersions).where(eq(filmVersions.id, id)),
    ...releaseDates(
      d,
      releaseDateRows.map((row) => row.id),
    ),
  ]);
  changedCatalogue();
  return { id };
}

// ── Personal copy writes ─────────────────────────────────────────────────────

function holdingValues(
  record: ReturnType<typeof filmHoldingRecordSchema.parse>,
  dates: { acquisitionDateId: string | null; dispositionDateId: string | null },
) {
  const {
    acquisitionDate: _acquisition,
    dispositionDate: _disposition,
    ...fields
  } = record;
  return { ...fields, ...dates };
}

/** Curating or watching a film never creates a copy; this is the only way. */
export async function addFilmHolding(input: FilmHoldingInput) {
  const { workId, ...fields } = input;
  z.uuid().parse(workId);
  const record = filmHoldingRecordSchema.parse({
    ...FILM_HOLDING_DEFAULTS,
    ...supplied(filmHoldingPatchSchema.parse(fields)),
  });
  const id = randomUUID();
  const acquisition = newDate(record.acquisitionDate),
    disposition = newDate(record.dispositionDate);
  await write((d) => [
    ...insertDates(d, [acquisition, disposition]),
    d.insert(filmHoldings).values({
      id,
      workId,
      ...holdingValues(record, {
        acquisitionDateId: acquisition?.id ?? null,
        dispositionDateId: disposition?.id ?? null,
      }),
    }),
  ]);
  changedHoldings();
  return (await getFilmHolding(id))!;
}

/** The patch is merged with the stored copy and validated as a whole. */
export async function updateFilmHolding(
  id: string,
  input: FilmHoldingPatch,
  fingerprint: string,
) {
  z.uuid().parse(id);
  const patch = supplied(filmHoldingPatchSchema.parse(input));
  const expected = fingerprintSchema.parse(fingerprint);
  const current = await getFilmHolding(id);
  fresh(expected)(current?.fingerprint ?? null);
  const stored = current!;
  const record = filmHoldingRecordSchema.parse({
    versionId: stored.versionId,
    releaseId: stored.releaseId,
    medium: stored.medium,
    formatLabel: stored.formatLabel,
    status: stored.status,
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
    d.execute(sql`select id from film_holdings where id=${id}::uuid for update`),
    d.execute(
      assertSql(
        sql`coalesce(${holdingFingerprint(sql`${id}::uuid`)}=${expected},false)`,
        STALE_RECORD,
      ),
    ),
    ...insertDates(d, [acquisition?.row, disposition?.row]),
    d
      .update(filmHoldings)
      .set({
        ...holdingValues(record, {
          acquisitionDateId: acquisition
            ? (acquisition.row?.id ?? null)
            : stored.acquisitionDateId,
          dispositionDateId: disposition
            ? (disposition.row?.id ?? null)
            : stored.dispositionDateId,
        }),
        updatedAt: new Date(),
      })
      .where(eq(filmHoldings.id, id)),
    ...releaseDates(d, [acquisition?.oldId, disposition?.oldId]),
  ]);
  changedHoldings();
  return (await getFilmHolding(id))!;
}

export async function deleteFilmHolding(id: string) {
  z.uuid().parse(id);
  const holding = await db.query.filmHoldings.findFirst({
    where: eq(filmHoldings.id, id),
    columns: { acquisitionDateId: true, dispositionDateId: true },
  });
  if (!holding) throw new Error("Copy not found");
  await write((d) => [
    d.delete(filmHoldings).where(eq(filmHoldings.id, id)),
    ...releaseDates(d, [holding.acquisitionDateId, holding.dispositionDateId]),
  ]);
  changedHoldings();
  return { id };
}
