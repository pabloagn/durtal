"use server";

import { z } from "zod";
import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { catalogueIdentifiers, countries, languages, media, sourceRecords, works } from "@/lib/db/schema";
import { stableStringify } from "@/lib/harmonization/normalize";
import { catalogueDateSchema, catalogueDateText, type CatalogueDateInput } from "@/lib/catalogue/dates";
import { CREDIT_ROLES } from "@/lib/catalogue/credits";
import { FILM_SOURCES, filmSourceChanges, releaseFormat, type FilmImage, type FilmLanguage, type FilmPlace, type FilmProposals } from "@/lib/catalogue/film-sources";
import { FILM_RELEASE_FORMAT_LABELS } from "@/lib/catalogue/film-labels";
import type { FILM_RELEASE_FORMATS } from "@/lib/catalogue/films";
import { ProviderError, type ProviderDetail } from "@/lib/providers/contract";
import { fetchProviderDetail, providerLocks, recordProviderDetail, reviewProposal, searchProvider } from "@/lib/providers/run";
import { matchIdentity } from "@/lib/providers/identity-match";
import { wikidataFilms } from "@/lib/providers/wikidata-films";
import { registerCatalogueIdentifier, reviewSourceObservation } from "./catalogue-provenance";
import { createPerson } from "./people";
import { saveOrganization } from "./organizations";
import { createFilmVersion, getFilm, updateFilm, updateFilmVersion } from "./films";

/*
 * Reviewed film lookup (SLN-376). Wikidata, the one film source with a
 * documented public API and no key, is looked up; what it says is reviewed
 * against the film before anything is saved. A value only fills an empty
 * field, and cast, crew, companies and releases are only ever added: a
 * different value stays a conflict for the person, and nothing the film has
 * is replaced or removed, since Wikidata's lists are often partial. People and
 * companies are matched by their Wikidata id first, then by one exact name;
 * countries and languages by their ISO code first, then by English name. A
 * Wikidata film belongs to one film here, and a different year stops the save
 * until the person confirms it is the same film: a remake is a separate film.
 */

const provider = wikidataFilms;
const WIKIDATA_COVERS = FILM_SOURCES.find((s) => s.name === "Wikidata")!.covers;
const QID = z.string().regex(/^Q\d+$/, "A Wikidata id looks like Q193570");
const ID_PROVIDERS = ["imdb", "tmdb", "letterboxd"] as const;
type IdProvider = (typeof ID_PROVIDERS)[number];
const ID_LINKS: Record<IdProvider, (id: string) => string> = {
  imdb: (id) => `https://www.imdb.com/title/${id}/`,
  tmdb: (id) => `https://www.themoviedb.org/movie/${id}`,
  letterboxd: (id) => `https://letterboxd.com/film/${id}/`,
};
const ID_NAMES: Record<IdProvider, string> = { imdb: "IMDb", tmdb: "TMDB", letterboxd: "Letterboxd" };

type Failure = { error: string };
const failure = (error: unknown): Failure => ({
  error:
    error instanceof ProviderError || error instanceof z.ZodError
      ? error instanceof z.ZodError
        ? error.issues.map((i) => i.message).join("; ")
        : error.message
      : "Wikidata could not be reached. Enter the film by hand.",
});

export interface FilmSourceHit {
  externalId: string;
  title: string;
  detail: string | null;
  url: string | null;
}

/** Films on Wikidata that match a title, a Wikidata id, or an IMDb or TMDB id or link */
export async function searchFilmSource(text: string): Promise<{ hits: FilmSourceHit[]; covers: string } | Failure> {
  try {
    const query = z.string().trim().min(1).max(300).parse(text);
    return { hits: await searchProvider(provider, { text: query, level: "work" }), covers: WIKIDATA_COVERS };
  } catch (error) {
    return failure(error);
  }
}

/** `unlisted`: none of the countries or languages is in Durtal's lists, so nothing can be filled */
export type FieldVerdict = "fill" | "same" | "conflict" | "locked" | "unlisted";
type Match = { id: string; name: string } | null;
export interface FilmSourceReview {
  externalId: string;
  url: string | null;
  title: string;
  attribution: string;
  covers: string;
  /** A locked Wikidata source on this film: nothing will change */
  locked: boolean;
  /** Another film here already has this Wikidata film */
  heldBy: { title: string; slug: string | null } | null;
  /** The first release's year here and on Wikidata; years more than one apart may be a remake */
  year: { here: number | null; source: number | null; differs: boolean };
  fields: { field: ScalarField | ListField; label: string; here: string | null; source: string; verdict: FieldVerdict; unmatched?: string[] }[];
  credits: { key: string; wikidataId: string; name: string; roleId: string; role: string; characters: string[]; match: Match; here: boolean }[];
  /** Credits Wikidata names without an English name, left out */
  unnamedCredits: number;
  organizations: { wikidataId: string; name: string; match: Match; here: boolean }[];
  identifiers: { provider: IdProvider; name: string; externalId: string; url: string; here: boolean; heldBy: string | null }[];
  /** The version a running time and releases go to: the film's first, or a new one */
  version: { id: string | null; label: string | null };
  runtime: { seconds: number; here: number | null; verdict: FieldVerdict } | null;
  releases: { index: number; date: string; place: string | null; country: Match; format: (typeof FILM_RELEASE_FORMATS)[number]; formatLabel: string; here: boolean }[];
  /** The poster or still Commons has, with its credit; `here` when the film has a poster */
  image: (FilmImage & { here: boolean }) | null;
  /** The last accepted Wikidata answer for this film, and what has changed in it since */
  previous: { retrievedAt: string; changes: string[] } | null;
}

type ScalarField = "title" | "originalTitle" | "description" | "releaseDate";
type ListField = "countries" | "languages";
const FIELD_LABELS: Record<ScalarField | ListField, string> = {
  title: "Title",
  originalTitle: "Original title",
  description: "Description",
  releaseDate: "First release",
  countries: "Countries",
  languages: "Original languages",
};
const ROLE_LABELS = new Map(CREDIT_ROLES.map((r) => [r.id, r.label]));

type Film = NonNullable<Awaited<ReturnType<typeof getFilm>>>;
type Found = Awaited<ReturnType<typeof fetchProviderDetail<"film">>>;

/** The proposals of one answer, by level */
function proposalsOf(found: { proposals: { level: string; fields: Record<string, unknown> }[] }): FilmProposals {
  return {
    work: (found.proposals.find((p) => p.level === "work")?.fields ?? {}) as FilmProposals["work"],
    runtimeSeconds: (found.proposals.find((p) => p.level === "version")?.fields.runtimeSeconds as number | undefined) ?? null,
    releases: found.proposals.filter((p) => p.level === "release").map((p) => p.fields as FilmProposals["releases"][number]),
  };
}

/** Dates compare in one shape: the stored value and the proposal, both read by the date rules */
const sameShape = (value: CatalogueDateInput | null | undefined) =>
  value ? (JSON.parse(stableStringify(catalogueDateSchema.parse(value))) as CatalogueDateInput) : null;

const lowerIn = (column: typeof countries.name | typeof languages.name, values: string[]) =>
  sql`lower(${column}) in (${sql.join(values.map((v) => sql`${v.toLowerCase()}`), sql`, `)})`;
const anyOf = (conditions: (SQL | false)[]) => or(...conditions.filter((c): c is SQL => !!c));
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Durtal's country for each Wikidata country or place: by its ISO 3166-1
 * alpha-2 code, else by its English name, which often differs ("United
 * States" here is "United States of America")
 */
async function countryMatcher(places: FilmPlace[]): Promise<(p: FilmPlace) => Match> {
  if (!places.length) return () => null;
  const codes = [...new Set(places.flatMap((p) => (p.alpha2 ? [p.alpha2.toUpperCase()] : [])))];
  const rows = await db
    .select({ id: countries.id, name: countries.name, alpha2: countries.alpha2 })
    .from(countries)
    .where(anyOf([codes.length > 0 && inArray(countries.alpha2, codes), lowerIn(countries.name, places.map((p) => p.name))]));
  return (p) => {
    const row = (p.alpha2 && rows.find((r) => r.alpha2 === p.alpha2!.toUpperCase())) || rows.find((r) => sameName(r.name, p.name));
    return row ? { id: row.id, name: row.name } : null;
  };
}

/** Durtal's language for each Wikidata language: by its ISO 639-1 code, else its 639-3 code, else its English name */
async function languageMatcher(spoken: FilmLanguage[]): Promise<(l: FilmLanguage) => Match> {
  if (!spoken.length) return () => null;
  const iso1 = [...new Set(spoken.flatMap((l) => (l.iso6391 ? [l.iso6391.toLowerCase()] : [])))];
  const iso3 = [...new Set(spoken.flatMap((l) => (l.iso6393 ? [l.iso6393.toLowerCase()] : [])))];
  const rows = await db
    .select({ id: languages.id, name: languages.name, iso6391: languages.iso6391, iso6393: languages.iso6393 })
    .from(languages)
    .where(
      anyOf([
        iso1.length > 0 && inArray(languages.iso6391, iso1),
        iso3.length > 0 && inArray(languages.iso6393, iso3),
        lowerIn(languages.name, spoken.map((l) => l.name)),
      ]),
    );
  return (l) => {
    const row =
      (l.iso6391 && rows.find((r) => r.iso6391 === l.iso6391!.toLowerCase())) ||
      (l.iso6393 && rows.find((r) => r.iso6393 === l.iso6393!.toLowerCase())) ||
      rows.find((r) => sameName(r.name, l.name));
    return row ? { id: row.id, name: row.name } : null;
  };
}

/** The matcher of a list field */
const matcherOf = (field: ListField, entries: FilmPlace[] | FilmLanguage[]) =>
  field === "countries" ? countryMatcher(entries as FilmPlace[]) : languageMatcher(entries as FilmLanguage[]);

async function heldIdentifier(providerId: string, externalId: string) {
  const [row] = await db
    .select({ workId: catalogueIdentifiers.workId, title: works.title, slug: works.slug })
    .from(catalogueIdentifiers)
    .innerJoin(works, eq(works.id, catalogueIdentifiers.workId))
    .where(and(eq(catalogueIdentifiers.provider, providerId), eq(catalogueIdentifiers.entityKind, "film"), eq(catalogueIdentifiers.externalId, externalId)))
    .limit(1);
  return row ?? null;
}

/** The last accepted answer of this provider for a film, as its proposals */
async function previousAnswer(filmId: string) {
  const [row] = await db
    .select({ payload: sourceRecords.payload, retrievedAt: sourceRecords.retrievedAt })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.entityKind, "film"),
        eq(sourceRecords.workId, filmId),
        eq(sourceRecords.provider, provider.id),
        eq(sourceRecords.reviewStatus, "accepted"),
      ),
    )
    .orderBy(desc(sourceRecords.retrievedAt), desc(sourceRecords.id))
    .limit(1);
  if (!row?.payload) return null;
  try {
    const proposals = provider.normalize({ externalId: "Q0", url: null, attribution: "Wikidata", license: null, payload: row.payload as ProviderDetail["payload"] });
    return { retrievedAt: row.retrievedAt, proposals: proposalsOf({ proposals }) };
  } catch {
    // An answer kept before this provider read films says nothing to compare
    return null;
  }
}

async function buildReview(film: Film | null, found: Found): Promise<FilmSourceReview> {
  const { work, runtimeSeconds, releases } = proposalsOf(found);
  const locks = film ? await providerLocks({ kind: "film", id: film.id }, provider.id) : { record: false, fields: [] };
  const verdictOf = (field: string, changes: Record<string, unknown>, conflicts: { field: unknown; reason: string }[]): FieldVerdict => {
    const conflict = conflicts.find((c) => c.field === field);
    return field in changes ? "fill" : conflict ? (conflict.reason === "locked" ? "locked" : "conflict") : "same";
  };

  // Title, original title, description and first release
  const current = {
    title: film?.title ?? null,
    originalTitle: film?.originalTitle ?? null,
    description: film?.description ?? null,
    releaseDate: sameShape(film?.releaseDate?.value) ?? null,
  };
  const scalar = { title: work.title, originalTitle: work.originalTitle, description: work.description, releaseDate: sameShape(work.releaseDate) ?? undefined };
  const { changes, conflicts } = reviewProposal(
    current,
    { level: "work", fields: Object.fromEntries(Object.entries(scalar).filter(([, v]) => v !== undefined)) },
    locks,
  );
  const fields: FilmSourceReview["fields"] = [];
  for (const field of ["title", "originalTitle", "description", "releaseDate"] as const) {
    const value = scalar[field];
    if (value === undefined) continue;
    const show = (v: unknown) => (v == null ? null : field === "releaseDate" ? catalogueDateText(v as never) : String(v));
    fields.push({ field, label: FIELD_LABELS[field], here: show(current[field]), source: show(value)!, verdict: verdictOf(field, changes, conflicts) });
  }

  // Countries and original languages: matched to Durtal's lists by ISO code, else by name; filled only when the film has none
  for (const [field, proposed, here] of [
    ["countries", work.countries ?? [], film?.countries ?? []],
    ["languages", work.languages ?? [], film?.languages ?? []],
  ] as const) {
    if (!proposed.length) continue;
    const match = await matcherOf(field, proposed);
    const matched = proposed.flatMap((p) => match(p) ?? []);
    const unmatched = proposed.filter((p) => !match(p)).map((p) => p.name);
    const ids = new Set(matched.map((m) => m.id));
    const same = ids.size > 0 && here.length === ids.size && here.every((h) => ids.has(h.id));
    const verdict: FieldVerdict = !ids.size ? "unlisted" : same ? "same" : locks.record ? "locked" : here.length ? "conflict" : "fill";
    fields.push({
      field,
      label: FIELD_LABELS[field],
      here: here.map((h) => h.name).join(", ") || null,
      source: proposed.map((p) => p.name).join(", "),
      verdict,
      unmatched,
    });
  }

  const credits = await Promise.all(
    (work.credits ?? []).map(async (c) => {
      const match = await matchIdentity(provider.id, "person", c.wikidataId, c.name);
      return {
        key: `${c.roleId}:${c.wikidataId}`,
        ...c,
        role: ROLE_LABELS.get(c.roleId) ?? c.roleId,
        match,
        here: !!match && !!film?.credits.some((x) => x.personId === match.id && x.roleId === c.roleId),
      };
    }),
  );
  const organizations = await Promise.all(
    (work.organizations ?? []).map(async (o) => {
      const match = await matchIdentity(provider.id, "organization", o.wikidataId, o.name);
      return {
        wikidataId: o.wikidataId,
        name: o.name,
        match,
        here: !!match && !!film?.organizations.some((x) => x.organizationId === match.id && x.role === "production_company"),
      };
    }),
  );
  const identifiers = await Promise.all(
    ID_PROVIDERS.flatMap((p) => (work.identifiers?.[p] ? [[p, work.identifiers[p]!] as const] : [])).map(async ([p, externalId]) => {
      const held = await heldIdentifier(p, externalId);
      return {
        provider: p,
        name: ID_NAMES[p],
        externalId,
        url: ID_LINKS[p](externalId),
        here: !!film && held?.workId === film.id,
        heldBy: held && held.workId !== film?.id ? held.title : null,
      };
    }),
  );

  // Running time and releases go to the film's first version, or a new one
  const version = film?.versions[0] ?? null;
  const runtime = runtimeSeconds
    ? {
        seconds: runtimeSeconds,
        here: version?.runtimeSeconds ?? null,
        verdict: (locks.record ? "locked" : !version?.runtimeSeconds ? "fill" : Math.abs(version.runtimeSeconds - runtimeSeconds) < 60 ? "same" : "conflict") as FieldVerdict,
      }
    : null;
  const placeCountry = await countryMatcher(releases.flatMap((r) => (r.place ? [r.place] : [])));
  const reviewed = releases.map((r, index) => {
    const country = r.place ? placeCountry(r.place) : null;
    const format = releaseFormat(r.place?.name ?? null);
    const date = sameShape(r.releaseDate);
    const here = !!version?.releases.some(
      (x) =>
        (country ? x.countryId === country.id : (x.territoryLabel ?? "").toLowerCase() === (r.place?.name ?? "").toLowerCase()) &&
        stableStringify(sameShape(x.releaseDate?.value)) === stableStringify(date),
    );
    return {
      index,
      date: catalogueDateText(date as never) ?? "",
      place: r.place?.name ?? null,
      country,
      format,
      formatLabel: FILM_RELEASE_FORMAT_LABELS[format],
      here,
    };
  });

  const [held, poster, previous] = await Promise.all([
    heldIdentifier(provider.id, found.detail.externalId),
    film
      ? db.select({ id: media.id }).from(media).where(and(eq(media.workId, film.id), eq(media.type, "poster"))).orderBy(asc(media.id)).limit(1)
      : Promise.resolve([]),
    film ? previousAnswer(film.id) : Promise.resolve(null),
  ]);
  const hereYear = film?.releaseDate?.value?.start?.year ?? null;
  const sourceYear = work.releaseDate?.start?.year ?? null;
  return {
    externalId: found.detail.externalId,
    url: found.detail.url,
    title: work.title ?? found.detail.externalId,
    attribution: found.detail.attribution,
    covers: WIKIDATA_COVERS,
    locked: locks.record,
    heldBy: held && held.workId !== film?.id ? { title: held.title, slug: held.slug } : null,
    year: { here: hereYear, source: sourceYear, differs: hereYear !== null && sourceYear !== null && Math.abs(hereYear - sourceYear) > 1 },
    fields,
    credits,
    unnamedCredits: Number((found.detail.payload as { unnamedCredits?: number }).unnamedCredits ?? 0),
    organizations,
    identifiers,
    version: { id: version?.id ?? null, label: version?.label ?? null },
    runtime,
    releases: reviewed,
    image: work.image ? { ...work.image, here: poster.length > 0 } : null,
    previous: previous
      ? { retrievedAt: previous.retrievedAt.toISOString(), changes: filmSourceChanges(previous.proposals, { work, runtimeSeconds, releases }) }
      : null,
  };
}

/**
 * What Wikidata says about a film, set against the film here when there is
 * one. Reads only.
 */
export async function reviewFilmSource(input: { filmId: string | null; externalId: string }): Promise<FilmSourceReview | Failure> {
  try {
    const { filmId, externalId } = z.object({ filmId: z.uuid().nullable(), externalId: QID }).parse(input);
    const film = filmId ? await getFilm(filmId) : null;
    if (filmId && !film) return { error: "Film not found" };
    return await buildReview(film, await fetchProviderDetail(provider, externalId));
  } catch (error) {
    return failure(error);
  }
}

const applySchema = z.object({
  filmId: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
  externalId: QID,
  /** The person confirms a film of another year is this one */
  sameFilm: z.boolean().default(false),
  /** Empty fields to fill from the source */
  fields: z.array(z.enum(["originalTitle", "description", "releaseDate", "countries", "languages"])).max(5).default([]),
  /** Credits to add, as `role:wikidataId`; a person not here yet is created */
  credits: z.array(z.string().max(100)).max(500).default([]),
  /** Wikidata ids of production companies to add */
  organizations: z.array(QID).max(100).default([]),
  identifiers: z.array(z.enum(ID_PROVIDERS)).max(3).default([]),
  runtime: z.boolean().default(false),
  /** Releases to add, by their place in the review */
  releases: z.array(z.number().int().min(0).max(199)).max(200).default([]),
});

async function ensureIdentifier(kind: "organization" | "person", id: string, wikidataId: string) {
  try {
    await registerCatalogueIdentifier({ owner: { kind, id }, provider: provider.id, externalId: wikidataId });
  } catch {
    // The id already names another record here: keep both as they are
  }
}

/**
 * Saves what the person accepted. The detail is fetched again and kept as an
 * accepted source of the film with its Wikidata id; accepted empty fields are
 * filled, and accepted credits, companies, ids, a running time and releases
 * are added. Nothing the film has is replaced or removed. A locked Wikidata
 * source, a Wikidata film another film has, or a different year the person
 * has not confirmed stops the whole save.
 */
export async function applyFilmSource(input: z.input<typeof applySchema>): Promise<{ sourceRecordId: string; added: string[] } | Failure> {
  try {
    const v = applySchema.parse(input);
    const owner = { kind: "film" as const, id: v.filmId };
    const film = await getFilm(v.filmId);
    if (!film) return { error: "Film not found" };
    if (film.fingerprint !== v.fingerprint) return { error: "This film changed since the review. Look it up again." };
    const found = await fetchProviderDetail(provider, v.externalId);
    const review = await buildReview(film, found);
    if (review.locked) return { error: "A locked Wikidata source keeps this film as it is" };
    if (review.heldBy) return { error: `This Wikidata film is already ${review.heldBy.title} here. A remake is a separate film.` };
    if (review.year.differs && !v.sameFilm)
      return {
        error: `Wikidata's film is from ${review.year.source}, this one from ${review.year.here}. A remake is a separate film: confirm it is the same film to save.`,
      };

    const observation = await recordProviderDetail(provider, owner, found);
    await reviewSourceObservation({ id: observation.id, expectedRevision: observation.revision, reviewStatus: "accepted", locked: false, verifiedAt: new Date() });
    const { work, releases } = proposalsOf(found);
    const added: string[] = [];
    const patch: Parameters<typeof updateFilm>[1] = {};

    for (const field of v.fields) {
      const row = review.fields.find((f) => f.field === field);
      if (row?.verdict !== "fill") continue;
      if (field === "originalTitle") patch.originalTitle = work.originalTitle ?? null;
      if (field === "description") patch.description = work.description ?? null;
      if (field === "releaseDate") {
        patch.releaseDate = work.releaseDate ?? null;
        // The date's source, unless the person already cited one
        if (!film.sourceRecordId) patch.sourceRecordId = observation.id;
      }
      if (field === "countries" || field === "languages") {
        const match = await matcherOf(field, work[field] ?? []);
        const ids = [...new Set((work[field] ?? []).flatMap((p) => match(p)?.id ?? []))];
        if (field === "countries") patch.countryIds = ids;
        else patch.languageIds = ids;
      }
      added.push(FIELD_LABELS[field]);
    }

    const organizations = film.organizations.map(({ organizationId, role, sourceRecordId }) => ({ organizationId, role, sourceRecordId }));
    for (const o of review.organizations.filter((x) => v.organizations.includes(x.wikidataId) && !x.here)) {
      const id = o.match?.id ?? (await saveOrganization({ name: o.name, roles: ["production_company"] }))!.id;
      await ensureIdentifier("organization", id, o.wikidataId);
      if (!organizations.some((x) => x.organizationId === id && x.role === "production_company")) {
        organizations.push({ organizationId: id, role: "production_company", sourceRecordId: observation.id });
        added.push(o.name);
      }
    }
    if (organizations.length !== film.organizations.length) patch.organizations = organizations;

    type Credit = NonNullable<Parameters<typeof updateFilm>[1]["credits"]>[number];
    const credits: Credit[] = film.credits.map((c) => ({
      id: c.id,
      personId: c.personId,
      roleId: c.roleId,
      creditedAs: c.creditedAs,
      attribution: c.attribution,
      characters: c.characters,
      notes: c.notes,
    }));
    const created = new Map<string, string>();
    let people = 0;
    for (const c of review.credits.filter((x) => v.credits.includes(x.key) && !x.here)) {
      const id = c.match?.id ?? created.get(c.wikidataId) ?? (await createPerson({ name: c.name, domains: ["film"] })).id;
      created.set(c.wikidataId, id);
      await ensureIdentifier("person", id, c.wikidataId);
      if (credits.some((x) => x.personId === id && x.roleId === c.roleId)) continue;
      // Attributed: a source names this person, the person has not confirmed it. Added after the credits here, in Wikidata's order
      credits.push({ personId: id, roleId: c.roleId, creditedAs: null, attribution: "attributed", characters: c.characters, notes: `Named by Wikidata (${c.wikidataId})` });
      people++;
    }
    if (people) added.push(`${people} ${people === 1 ? "credit" : "credits"}`);
    if (credits.length !== film.credits.length) patch.credits = credits;

    if (Object.keys(patch).length) await updateFilm(film.id, patch, film.fingerprint);

    for (const p of v.identifiers) {
      const row = review.identifiers.find((i) => i.provider === p);
      if (!row || row.here || row.heldBy) continue;
      await registerCatalogueIdentifier({ owner, provider: p, externalId: row.externalId });
      added.push(`${row.name} id`);
    }

    // The running time and releases: on the film's first version, or a new one
    const chosen = review.releases.filter((r) => v.releases.includes(r.index) && !r.here);
    const newReleases = chosen.map((r) => ({
      countryId: r.country?.id ?? null,
      territoryLabel: r.country ? null : r.place,
      format: r.format,
      releaseDate: releases[r.index].releaseDate,
      distributorId: null,
      notes: null,
      sourceRecordId: observation.id,
    }));
    const runtime = v.runtime && review.runtime?.verdict === "fill" ? review.runtime.seconds : null;
    if (runtime || newReleases.length) {
      const version = film.versions[0];
      if (!version) await createFilmVersion({ workId: film.id, runtimeSeconds: runtime, sourceRecordId: observation.id, releases: newReleases });
      else
        await updateFilmVersion(
          version.id,
          {
            ...(runtime ? { runtimeSeconds: runtime } : {}),
            ...(newReleases.length
              ? {
                  releases: [
                    ...version.releases.map((r) => ({
                      id: r.id,
                      countryId: r.countryId,
                      territoryLabel: r.territoryLabel,
                      format: r.format,
                      releaseDate: r.releaseDate?.value ?? null,
                      distributorId: r.distributorId,
                      notes: r.notes,
                      sourceRecordId: r.sourceRecordId,
                    })),
                    ...newReleases,
                  ],
                }
              : {}),
          },
          version.fingerprint,
        );
      if (runtime) added.push("Running time");
      if (newReleases.length) added.push(`${newReleases.length} ${newReleases.length === 1 ? "release" : "releases"}`);
    }
    return { sourceRecordId: observation.id, added };
  } catch (error) {
    if (error instanceof Error && !(error instanceof ProviderError) && !(error instanceof z.ZodError)) return { error: error.message };
    return failure(error);
  }
}
