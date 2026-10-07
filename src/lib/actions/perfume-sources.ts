"use server";

import { z } from "zod";
import { stableStringify } from "@/lib/harmonization/normalize";
import { catalogueDateSchema, catalogueDateText, type CatalogueDateInput } from "@/lib/catalogue/dates";
import { PERFUME_SOURCES, readPerfumeLink } from "@/lib/catalogue/perfume-sources";
import { ProviderError } from "@/lib/providers/contract";
import { fetchProviderDetail, providerLocks, recordProviderDetail, reviewProposal, searchProvider } from "@/lib/providers/run";
import { matchIdentity } from "@/lib/providers/identity-match";
import { wikidataPerfumes } from "@/lib/providers/wikidata-perfumes";
import { citeSource, registerCatalogueIdentifier, reviewSourceObservation } from "./catalogue-provenance";
import { createPerson } from "./people";
import { saveOrganization } from "./organizations";
import { getPerfume, updatePerfume } from "./perfumes";

/*
 * Source-assisted perfume entry (SLN-377). A link is read by its address
 * only. Wikidata, the one perfume source with a documented public API, is
 * looked up; what it says is reviewed against the perfume before anything is
 * saved. A value only fills an empty field; a different value stays a
 * conflict, kept in the source observation, for the person to settle by
 * hand. Houses and perfumers are matched by their Wikidata id first, then by
 * an exact, unique name; nothing is matched on a title alone.
 */

const provider = wikidataPerfumes;
const WIKIDATA_COVERS = PERFUME_SOURCES.find((s) => s.name === "Wikidata")!.covers;

type Failure = { error: string };
const failure = (error: unknown): Failure => ({
  error: error instanceof ProviderError || error instanceof z.ZodError ? readable(error) : "Wikidata could not be reached. Enter the perfume by hand.",
});
function readable(error: ProviderError | z.ZodError) {
  return error instanceof z.ZodError ? error.issues.map((i) => i.message).join("; ") : error.message;
}

export interface SourceHit {
  externalId: string;
  title: string;
  detail: string | null;
  url: string | null;
}

/** Perfumes on Wikidata that match a name */
export async function searchPerfumeSource(text: string): Promise<{ hits: SourceHit[]; covers: string } | Failure> {
  try {
    const query = z.string().trim().min(1).max(300).parse(text);
    return { hits: await searchProvider(provider, { text: query, level: "work" }), covers: WIKIDATA_COVERS };
  } catch (error) {
    return failure(error);
  }
}

interface Proposed {
  title?: string;
  description?: string;
  launched?: CatalogueDateInput;
  organizations?: { wikidataId: string; name: string; role: "brand" | "manufacturer" }[];
  perfumers?: { wikidataId: string; name: string }[];
}

export type FieldVerdict = "fill" | "same" | "conflict" | "locked";
export interface PerfumeSourceReview {
  externalId: string;
  url: string | null;
  title: string;
  attribution: string;
  covers: string;
  /** A locked Wikidata source on this perfume: nothing will change */
  locked: boolean;
  fields: { field: "title" | "description" | "launched"; label: string; here: string | null; source: string; verdict: FieldVerdict }[];
  /** The proposed values themselves, for a form to take */
  values: { description: string | null; launched: CatalogueDateInput | null };
  organizations: { wikidataId: string; name: string; role: "brand" | "manufacturer"; match: { id: string; name: string } | null; here: boolean }[];
  perfumers: { wikidataId: string; name: string; match: { id: string; name: string } | null; here: boolean }[];
}

const FIELD_LABELS = { title: "Title", description: "Description", launched: "Launched" } as const;
const shown = (field: keyof typeof FIELD_LABELS, value: unknown) =>
  value === null || value === undefined
    ? null
    : field === "launched"
      ? catalogueDateText(value as never) || null
      : String(value);

/**
 * What Wikidata says about a perfume, set against the perfume here when there
 * is one. Reads only.
 */
export async function reviewPerfumeSource(input: { perfumeId: string | null; externalId: string }): Promise<PerfumeSourceReview | Failure> {
  try {
    const { perfumeId, externalId } = z.object({ perfumeId: z.uuid().nullable(), externalId: z.string().regex(/^Q\d+$/, "A Wikidata id looks like Q820507") }).parse(input);
    const perfume = perfumeId ? await getPerfume(perfumeId) : null;
    if (perfumeId && !perfume) return { error: "Perfume not found" };
    const found = await fetchProviderDetail(provider, externalId);
    return await buildReview(perfume, found);
  } catch (error) {
    return failure(error);
  }
}

type Perfume = NonNullable<Awaited<ReturnType<typeof getPerfume>>>;
type Found = Awaited<ReturnType<typeof fetchProviderDetail<"perfume">>>;

async function buildReview(perfume: Perfume | null, found: Found): Promise<PerfumeSourceReview> {
  const proposed = (found.proposals[0]?.fields ?? {}) as Proposed;
  const locks = perfume ? await providerLocks({ kind: "perfume", id: perfume.id }, provider.id) : { record: false, fields: [] };
  // Dates compare in one shape: the stored value and the proposal, both read by the date rules
  const date = (value: CatalogueDateInput | null | undefined) =>
    value ? (JSON.parse(stableStringify(catalogueDateSchema.parse(value))) as CatalogueDateInput) : value;
  const current = {
    title: perfume?.title ?? null,
    description: perfume?.description ?? null,
    launched: date(perfume?.releaseDate?.value) ?? null,
  };
  const scalar = { title: proposed.title, description: proposed.description, launched: date(proposed.launched) };
  const { changes, conflicts } = reviewProposal(
    current,
    { level: "work", fields: Object.fromEntries(Object.entries(scalar).filter(([, v]) => v !== undefined)) },
    locks,
  );
  const fields: PerfumeSourceReview["fields"] = [];
  for (const field of ["title", "description", "launched"] as const) {
    const value = scalar[field];
    if (value === undefined) continue;
    const conflict = conflicts.find((c) => c.field === field);
    const verdict: FieldVerdict = field in changes ? "fill" : conflict ? (conflict.reason === "locked" ? "locked" : "conflict") : "same";
    fields.push({ field, label: FIELD_LABELS[field], here: shown(field, current[field]), source: shown(field, value)!, verdict });
  }
  const organizations = await Promise.all(
    (proposed.organizations ?? []).map(async (o) => {
      const match = await matchIdentity(provider.id, "organization", o.wikidataId, o.name);
      return { ...o, match, here: !!match && !!perfume?.organizations.some((x) => x.organizationId === match.id) };
    }),
  );
  const perfumers = await Promise.all(
    (proposed.perfumers ?? []).map(async (p) => {
      const match = await matchIdentity(provider.id, "person", p.wikidataId, p.name);
      return { ...p, match, here: !!match && !!perfume?.credits.some((c) => c.personId === match.id && c.roleId === "perfume.perfumer") };
    }),
  );
  return {
    externalId: found.detail.externalId,
    url: found.detail.url,
    title: proposed.title ?? found.detail.externalId,
    attribution: found.detail.attribution,
    covers: WIKIDATA_COVERS,
    locked: locks.record,
    fields,
    values: { description: proposed.description ?? null, launched: proposed.launched ?? null },
    organizations,
    perfumers,
  };
}

const applySchema = z.object({
  perfumeId: z.uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
  externalId: z.string().regex(/^Q\d+$/),
  /** Empty fields to fill from the source */
  fields: z.array(z.enum(["description", "launched"])).max(2).default([]),
  /** Wikidata ids of houses and perfumers to add; one not here yet is created */
  organizations: z.array(z.string().regex(/^Q\d+$/)).max(20).default([]),
  perfumers: z.array(z.string().regex(/^Q\d+$/)).max(50).default([]),
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
 * accepted source of the perfume; accepted empty fields are filled, and
 * accepted houses and perfumers are added (created when they are not here).
 * Nothing the perfume has is replaced or removed. A locked Wikidata source
 * stops the whole save.
 */
export async function applyPerfumeSource(input: z.input<typeof applySchema>): Promise<{ sourceRecordId: string; added: string[] } | Failure> {
  try {
    const v = applySchema.parse(input);
    const owner = { kind: "perfume" as const, id: v.perfumeId };
    const perfume = await getPerfume(v.perfumeId);
    if (!perfume) return { error: "Perfume not found" };
    if (perfume.fingerprint !== v.fingerprint) return { error: "This perfume changed since the review. Look it up again." };
    const found = await fetchProviderDetail(provider, v.externalId);
    const review = await buildReview(perfume, found);
    if (review.locked) return { error: "A locked Wikidata source keeps this perfume as it is" };

    const observation = await recordProviderDetail(provider, owner, found);
    await reviewSourceObservation({ id: observation.id, expectedRevision: observation.revision, reviewStatus: "accepted", locked: false, verifiedAt: new Date() });
    const proposed = (found.proposals[0]?.fields ?? {}) as Proposed;
    const added: string[] = [];
    const patch: Parameters<typeof updatePerfume>[1] = {};

    for (const field of v.fields) {
      const row = review.fields.find((f) => f.field === field);
      if (row?.verdict !== "fill") continue;
      if (field === "description") patch.description = proposed.description ?? null;
      if (field === "launched") {
        patch.releaseDate = proposed.launched ?? null;
        // The dates' source, unless the person already cited one
        if (!perfume.sourceRecordId) patch.sourceRecordId = observation.id;
      }
      added.push(FIELD_LABELS[field]);
    }

    const organizations = perfume.organizations.map(({ organizationId, role, sourceRecordId }) => ({ organizationId, role, sourceRecordId }));
    for (const o of review.organizations.filter((x) => v.organizations.includes(x.wikidataId) && !x.here)) {
      const id = o.match?.id ?? (await saveOrganization({ name: o.name, roles: [o.role] }))!.id;
      await ensureIdentifier("organization", id, o.wikidataId);
      if (!organizations.some((x) => x.organizationId === id && x.role === o.role)) {
        organizations.push({ organizationId: id, role: o.role, sourceRecordId: observation.id });
        added.push(o.name);
      }
    }
    if (organizations.length !== perfume.organizations.length) patch.organizations = organizations;

    type Credit = NonNullable<Parameters<typeof updatePerfume>[1]["credits"]>[number];
    const credits: Credit[] = perfume.credits.map((c) => ({
      id: c.id,
      personId: c.personId,
      roleId: c.roleId,
      creditedAs: c.creditedAs,
      attribution: c.attribution,
      characters: c.characters,
      notes: c.notes,
    }));
    for (const p of review.perfumers.filter((x) => v.perfumers.includes(x.wikidataId) && !x.here)) {
      const id = p.match?.id ?? (await createPerson({ name: p.name, domains: ["perfume"] })).id;
      await ensureIdentifier("person", id, p.wikidataId);
      if (!credits.some((c) => c.personId === id && c.roleId === "perfume.perfumer")) {
        // Attributed: a source names this perfumer, the person has not confirmed it
        credits.push({ personId: id, roleId: "perfume.perfumer", creditedAs: null, attribution: "attributed", characters: [], notes: `Named by Wikidata (${p.wikidataId})` });
        added.push(p.name);
      }
    }
    if (credits.length !== perfume.credits.length) patch.credits = credits;

    if (Object.keys(patch).length) await updatePerfume(perfume.id, patch, perfume.fingerprint);
    return { sourceRecordId: observation.id, added };
  } catch (error) {
    if (error instanceof Error && !(error instanceof ProviderError) && !(error instanceof z.ZodError)) return { error: error.message };
    return failure(error);
  }
}

/**
 * The source a new perfume was entered from: a Wikidata item is kept as an
 * accepted observation with its id; any other link is cited as the person's
 * own source. The link's page is never read.
 */
export async function recordPerfumeEntrySource(input: { perfumeId: string; link: string; retrievedOn: string }): Promise<{ sourceRecordId: string } | Failure> {
  try {
    const v = z.object({ perfumeId: z.uuid(), link: z.string().max(4000), retrievedOn: z.iso.date() }).parse(input);
    const reading = readPerfumeLink(v.link);
    if (!reading) return { error: "The source link is not a web address" };
    const owner = { kind: "perfume" as const, id: v.perfumeId };
    if (reading.source?.access === "lookup" && reading.externalId) {
      const found = await fetchProviderDetail(provider, reading.externalId);
      const observation = await recordProviderDetail(provider, owner, found);
      await reviewSourceObservation({ id: observation.id, expectedRevision: observation.revision, reviewStatus: "accepted", locked: false, verifiedAt: new Date() });
      return { sourceRecordId: observation.id };
    }
    const cited = await citeSource({
      owner,
      url: reading.url,
      attribution: reading.source?.name ?? reading.host,
      retrievedOn: v.retrievedOn,
    });
    return { sourceRecordId: cited!.id };
  } catch (error) {
    if (error instanceof Error && !(error instanceof ProviderError) && !(error instanceof z.ZodError)) return { error: error.message };
    return failure(error);
  }
}
