"use server";

import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { stableStringify } from "@/lib/harmonization/normalize";
import { catalogueDateSchema, catalogueDateText, type CatalogueDateInput } from "@/lib/catalogue/dates";
import { compareSizes, convertSize, sizeText, sourceChanges, type Size, type SourceChange } from "@/lib/catalogue/painting-sources";
import { ProviderError, type ProviderDetail } from "@/lib/providers/contract";
import { fetchProviderDetail, providerLocks, recordProviderDetail, reviewProposal, searchProvider } from "@/lib/providers/run";
import { articArtworks, metArtworks, museumProposals, type MuseumArtwork } from "@/lib/providers/museums";
import { refreshSourceObservation, registerCatalogueIdentifier, reviewSourceObservation } from "./catalogue-provenance";
import { createPerson } from "./people";
import { saveOrganization } from "./organizations";
import { createArtObject, getArtObject, getPainting, updateArtObject, updatePainting } from "./paintings";
import { getWhereabouts, recordWhereabouts, updateWhereabouts } from "./whereabouts";

/*
 * Museum-source painting enrichment (SLN-378). A museum's answer is reviewed
 * against the painting and its original before anything is saved: a value
 * fills only an empty field; a different value stays a conflict. A location
 * is never taken from ownership. Only a museum's own dated answer that the
 * object is on view in its galleries can confirm or record a location, and
 * then through the same history path, with the same checks, as a manual
 * record. A museum that does not show an object, or does not say, changes
 * nothing: an unknown location stays unknown.
 */

const MUSEUMS = { artic: articArtworks, metmuseum: metArtworks } as const;
type MuseumId = keyof typeof MUSEUMS;
const museumSchema = z.enum(["artic", "metmuseum"]);

/** A recorded answer older than this is shown as stale */
const STALE_SOURCE_DAYS = 365;

type Failure = { error: string };
function failure(error: unknown, museum: string): Failure {
  if (error instanceof z.ZodError) return { error: error.issues.map((i) => i.message).join("; ") };
  if (error instanceof ProviderError) return { error: error.message };
  if (error instanceof Error) return { error: error.message };
  return { error: `${museum} could not be reached. Enter the painting by hand.` };
}

export async function searchPaintingSource(input: { museum: MuseumId; text: string }) {
  const museum = MUSEUMS[museumSchema.parse(input.museum)];
  try {
    const text = z.string().trim().min(1).max(300).parse(input.text);
    return { hits: await searchProvider(museum, { text, level: "work" }) };
  } catch (error) {
    return failure(error, museum.label);
  }
}

type Verdict = "fill" | "same" | "conflict" | "locked";
export interface PaintingSourceReview {
  museum: MuseumId;
  museumName: string;
  externalId: string;
  url: string | null;
  title: string;
  attribution: string | null;
  medium: string | null;
  locked: boolean;
  /** The last answer of this museum about this painting, how old it is, and what changed */
  previous: { retrievedAt: string; ageDays: number; stale: boolean; changes: SourceChange[] } | null;
  work: { field: "title" | "creationDate"; label: string; here: string | null; source: string; verdict: Verdict }[];
  painter: { name: string; attribution: string | null; match: { id: string; name: string } | null; here: boolean; others: string[] } | null;
  /** The original the answer applies to; none: saving can add it */
  object: { id: string; label: string; fingerprint: string } | null;
  objectFields: { field: "accessionNumber" | "owner" | "dimensions"; label: string; here: string | null; source: string; verdict: Verdict }[];
  owner: { name: string; wikidataId: string; match: { id: string; name: string } | null };
  location: {
    evidence: "on_view" | "not_on_view" | "unknown";
    /** What the museum says, with the day it said it */
    says: string;
    /** What saving would do; none when it may not */
    action: "record" | "verify" | "move" | null;
    /** Why, or what it changes */
    note: string;
    venue: { id: string; name: string } | null;
    historyFingerprint: string | null;
  };
  image: { url: string; credit: string; license: string | null } | null;
}

const dayText = (at: Date) => at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const sameDate = (a: CatalogueDateInput | null, b: CatalogueDateInput | null) =>
  !!a && !!b && stableStringify(catalogueDateSchema.parse(a)) === stableStringify(catalogueDateSchema.parse(b));

async function matchOne(table: "publishing_houses" | "authors", kind: "organization" | "person", wikidataId: string | null, name: string) {
  const column = kind === "organization" ? sql`organization_id` : sql`person_id`;
  const byId = wikidataId
    ? resultRows<{ id: string }>(
        await db.execute(
          sql`select ${column} as id from catalogue_identifiers where provider = 'wikidata' and entity_kind = ${kind} and external_id = ${wikidataId} limit 1`,
        ),
      )
    : [];
  const aliases =
    kind === "organization"
      ? sql`select publisher_id from publisher_aliases where lower(name) = lower(${name})`
      : sql`select person_id from person_aliases where lower(name) = lower(${name})`;
  const rows = byId.length
    ? byId
    : resultRows<{ id: string }>(
        await db.execute(sql`select id from ${sql.identifier(table)} where lower(name) = lower(${name}) or id in (${aliases}) limit 2`),
      );
  if (rows.length !== 1) return null;
  const [row] = resultRows<{ id: string; name: string }>(
    await db.execute(sql`select id, name from ${sql.identifier(table)} where id = ${rows[0].id}::uuid`),
  );
  return row ?? null;
}

/** The venue an organization runs, when it runs one */
async function venueOf(organizationId: string | null) {
  if (!organizationId) return null;
  const rows = resultRows<{ id: string; name: string }>(
    await db.execute(sql`select v.id, v.name from organization_venues ov join venues v on v.id = ov.venue_id
      where ov.organization_id = ${organizationId}::uuid and ov.role = 'operator' and v.archived_at is null order by v.name limit 2`),
  );
  return rows.length === 1 ? rows[0] : null;
}

/** The latest answer of a museum about a painting, kept as a source */
async function previousAnswer(paintingId: string, museum: MuseumId, externalId: string) {
  const [row] = resultRows<{ id: string; revision: number; retrieved_at: string; payload: Record<string, unknown>; locked: boolean }>(
    await db.execute(sql`select sr.id, sr.revision, sr.retrieved_at, sr.payload, sr.locked from source_records sr
      join catalogue_identifiers ci on ci.id = sr.identifier_id
      where sr.entity_kind = 'painting' and sr.work_id = ${paintingId}::uuid and sr.provider = ${museum} and ci.external_id = ${externalId}
        and not exists (select 1 from source_records n where n.supersedes_id = sr.id)
      order by sr.retrieved_at desc, sr.id limit 1`),
  );
  return row ? { ...row, retrievedAt: new Date(row.retrieved_at) } : null;
}

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  creationDate: "Date",
  painter: "Attribution",
  accessionNumber: "Accession number",
  owner: "Owner",
  dimensions: "Size",
  display: "On view",
  image: "Image",
};
function showValue(field: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const v = value as Record<string, unknown>;
  switch (field) {
    case "creationDate":
      return catalogueDateText(catalogueDateSchema.parse(value)) || null;
    case "painter":
      return String(v.attribution ?? v.name ?? "");
    case "owner":
      return String(v.name ?? "");
    case "dimensions":
      return sizeText(v as unknown as Size);
    case "display":
      return v.onView === true ? `Yes${v.gallery ? `, ${v.gallery}` : ""}` : v.onView === false ? "No" : "Not said";
    case "image":
      return String(v.url ?? "");
    default:
      return String(value);
  }
}
const flatten = (detail: Pick<ProviderDetail, "payload">) => {
  const out: Record<string, unknown> = {};
  for (const proposal of museumProposals(detail as ProviderDetail))
    for (const [field, value] of Object.entries(proposal.fields))
      out[field] = field === "owner" ? { name: (value as { name: string }).name } : value;
  return out;
};

type Painting = NonNullable<Awaited<ReturnType<typeof getPainting>>>;
type Found = Awaited<ReturnType<typeof fetchProviderDetail<"painting">>>;

async function buildReview(museumId: MuseumId, painting: Painting, objectId: string | null, found: Found): Promise<PaintingSourceReview> {
  const museum = MUSEUMS[museumId];
  const artwork = found.detail.payload as unknown as MuseumArtwork;
  const fields = Object.fromEntries(found.proposals.map((p) => [p.level, p.fields])) as {
    work: { title?: string; creationDate?: CatalogueDateInput; painter?: { name: string; attribution: string | null } };
    art_object: {
      owner: { name: string; wikidataId: string };
      accessionNumber?: string;
      dimensions?: { height: number | null; width: number | null; depth: number | null; unit: "cm" };
    };
  };
  const owner = { kind: "painting" as const, id: painting.id };
  const locks = await providerLocks(owner, museum.id);
  const verdictOf = (field: string, changes: Record<string, unknown>, conflicts: { field: unknown; reason: string }[]): Verdict =>
    field in changes ? "fill" : conflicts.some((c) => c.field === field && c.reason === "locked") ? "locked" : conflicts.some((c) => c.field === field) ? "conflict" : "same";

  // The work
  const work: PaintingSourceReview["work"] = [];
  const currentDate = painting.creationDate?.value ?? null;
  const proposedDate = fields.work.creationDate ?? null;
  const workReview = reviewProposal(
    { title: painting.title, creationDate: currentDate && proposedDate && sameDate(currentDate, proposedDate) ? proposedDate : currentDate },
    { level: "work", fields: { ...(fields.work.title && { title: fields.work.title }), ...(proposedDate && { creationDate: proposedDate }) } },
    locks,
  );
  if (fields.work.title)
    work.push({ field: "title", label: "Title", here: painting.title, source: fields.work.title, verdict: verdictOf("title", workReview.changes, workReview.conflicts) });
  if (proposedDate)
    work.push({
      field: "creationDate",
      label: "Date",
      here: currentDate ? catalogueDateText(currentDate) || null : null,
      source: catalogueDateText(catalogueDateSchema.parse(proposedDate)) ?? "",
      verdict: verdictOf("creationDate", workReview.changes, workReview.conflicts),
    });

  // The painter: matched by a unique exact name; a different painter here stays
  let painter: PaintingSourceReview["painter"] = null;
  if (fields.work.painter) {
    const match = await matchOne("authors", "person", null, fields.work.painter.name);
    const painters = painting.credits.filter((c) => c.roleId === "painting.painter");
    painter = {
      ...fields.work.painter,
      match,
      here: !!match && painters.some((c) => c.personId === match.id),
      others: painters.filter((c) => !match || c.personId !== match.id).map((c) => c.person?.name ?? c.creditedAs ?? "Unknown"),
    };
  }

  // The original
  const original = objectId
    ? painting.objects.find((o) => o.id === objectId) ?? null
    : (painting.objects.filter((o) => o.kind === "original").length === 1 ? painting.objects.find((o) => o.kind === "original")! : null);
  const ownerMatch = await matchOne("publishing_houses", "organization", fields.art_object.owner.wikidataId, fields.art_object.owner.name);
  const objectFields: PaintingSourceReview["objectFields"] = [];
  const accession = fields.art_object.accessionNumber;
  const lockedVerdict = (v: Verdict): Verdict => (locks.record && v !== "same" ? "locked" : v);
  if (accession)
    objectFields.push({
      field: "accessionNumber",
      label: "Accession number",
      here: original?.accessionNumber ?? null,
      source: accession,
      verdict: lockedVerdict(!original?.accessionNumber ? "fill" : original.accessionNumber.trim() === accession ? "same" : "conflict"),
    });
  const ownedHere = original?.ownership === "institutional" ? original.ownerName : original?.ownership && original.ownership !== "unknown" ? `${original.ownership} owner` : null;
  objectFields.push({
    field: "owner",
    label: "Owner",
    here: ownedHere,
    source: fields.art_object.owner.name,
    verdict: lockedVerdict(
      !original || original.ownership === "unknown"
        ? "fill"
        : original.ownership === "institutional" && ownerMatch && original.ownerOrganizationId === ownerMatch.id
          ? "same"
          : "conflict",
    ),
  });
  if (fields.art_object.dimensions) {
    const museumSize: Size = fields.art_object.dimensions;
    const hereSize: Size = {
      height: original?.height ?? null,
      width: original?.width ?? null,
      depth: original?.depth ?? null,
      unit: (original?.dimensionUnit as Size["unit"]) ?? null,
    };
    const verdict = compareSizes(hereSize, museumSize);
    const inHereUnit = hereSize.unit && hereSize.unit !== "cm" ? sizeText(convertSize(museumSize, hereSize.unit)) : null;
    objectFields.push({
      field: "dimensions",
      label: "Size",
      here: sizeText(hereSize),
      source: [sizeText(museumSize), inHereUnit && `about ${inHereUnit}`].filter(Boolean).join(", "),
      verdict: lockedVerdict(verdict),
    });
  }

  // Where it is: only the museum's own "on view" answer counts, dated the day it was given
  const observed = dayText(found.retrievedAt);
  const history = original ? await getWhereabouts(original.id) : null;
  const current = history?.current ?? null;
  const ownerOrganization = ownerMatch?.id ?? null;
  const venue = await venueOf(ownerOrganization);
  const evidence = artwork.onView === true ? "on_view" : artwork.onView === false ? "not_on_view" : "unknown";
  let action: PaintingSourceReview["location"]["action"] = null;
  let note: string;
  const whereHere = current
    ? `Here it is ${current.placeKind === "venue" ? `at ${current.venueName}` : current.placeKind}${current.custody !== "unknown" ? ` (${current.custody.replaceAll("_", " ")})` : ""}`
    : "Here its location is not recorded";
  if (evidence !== "on_view") {
    note = `${museum.label} ${evidence === "not_on_view" ? "does not show it now and does not say where it is" : "does not say whether it is shown"}. ${current ? "The location here stays as it is." : "Its location stays unknown."}`;
  } else if (locks.record) {
    note = "A locked source from this museum keeps the location as it is.";
  } else if (!venue) {
    note = `${whereHere}. To record where it is shown, link a venue to ${ownerMatch?.name ?? fields.art_object.owner.name} under Organizations.`;
  } else if (!current) {
    action = "record";
    note = `${whereHere}. Saving records it at ${venue.name}, on display, checked ${observed}.`;
  } else if (current.placeKind === "venue" && current.venueId === venue.id) {
    action = "verify";
    note = `${whereHere}. Saving marks it checked on ${observed}${current.displayStatus === "unknown" ? ", on display" : ""}.`;
  } else {
    action = "move";
    note = `${whereHere}. Saving records a move to ${venue.name} on ${observed}, which closes that record.`;
  }
  const says =
    evidence === "on_view"
      ? `On view${artwork.gallery ? ` in ${artwork.gallery}` : ""} at ${artwork.institution.name}, as of ${observed}`
      : evidence === "not_on_view"
        ? `Not on view at ${artwork.institution.name}, as of ${observed}`
        : `${artwork.institution.name} does not say whether it is on view`;

  // The last answer of this museum, and what changed since
  const previous = await previousAnswer(painting.id, museum.id as MuseumId, found.detail.externalId);
  const ageDays = previous ? Math.max(0, Math.floor((Date.now() - previous.retrievedAt.getTime()) / 86400000)) : 0;

  return {
    museum: museum.id as MuseumId,
    museumName: museum.label,
    externalId: found.detail.externalId,
    url: found.detail.url,
    title: artwork.title ?? found.detail.externalId,
    attribution: artwork.attribution,
    medium: artwork.medium,
    locked: locks.record,
    previous: previous
      ? {
          retrievedAt: previous.retrievedAt.toISOString(),
          ageDays,
          stale: ageDays >= STALE_SOURCE_DAYS,
          changes: sourceChanges(flatten({ payload: previous.payload as ProviderDetail["payload"] }), flatten(found.detail), showValue).map((c) => ({
            ...c,
            field: FIELD_LABELS[c.field] ?? c.field,
          })),
        }
      : null,
    work,
    painter,
    object: original ? { id: original.id, label: original.label ?? "The original", fingerprint: original.fingerprint } : null,
    objectFields,
    owner: { ...fields.art_object.owner, match: ownerMatch },
    location: { evidence, says, action, note, venue, historyFingerprint: history?.fingerprint ?? null },
    image: artwork.image,
  };
}

const target = z.object({
  museum: museumSchema,
  paintingId: z.uuid(),
  externalId: z.string().regex(/^\d+$/, "A museum id is a number"),
  /** The original; none takes the painting's only original */
  objectId: z.uuid().nullable().default(null),
});

/** What a museum says about a painting, set against it. Reads only */
export async function reviewPaintingSource(input: z.input<typeof target>): Promise<PaintingSourceReview | Failure> {
  const museum = MUSEUMS[museumSchema.parse(input.museum)];
  try {
    const v = target.parse(input);
    const painting = await getPainting(v.paintingId);
    if (!painting) return { error: "Painting not found" };
    const found = await fetchProviderDetail(museum, v.externalId);
    return await buildReview(v.museum, painting, v.objectId, found);
  } catch (error) {
    return failure(error, museum.label);
  }
}

const applySchema = target.extend({
  fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
  objectFingerprint: z.string().regex(/^[a-f0-9]{32}$/).nullable().default(null),
  historyFingerprint: z.string().regex(/^[a-f0-9]{32}$/).nullable().default(null),
  /** Empty fields of the work to fill */
  work: z.array(z.enum(["creationDate"])).default([]),
  /** Credit the museum's painter, attributed */
  painter: z.boolean().default(false),
  /** Empty fields of the original to fill */
  object: z.array(z.enum(["accessionNumber", "owner", "dimensions"])).default([]),
  /** Add the original when the painting has none */
  createObject: z.boolean().default(false),
  /** Take the review's location step: record, confirm or move */
  location: z.boolean().default(false),
});

async function ensureIdentifier(kind: "organization" | "person", id: string, wikidataId: string) {
  try {
    await registerCatalogueIdentifier({ owner: { kind, id }, provider: "wikidata", externalId: wikidataId });
  } catch {
    // Another record holds that id here: both stay as they are
  }
}

/**
 * Saves what the person accepted from a museum's answer. The answer is
 * fetched again; a stale review, a locked source or a changed history stops
 * the save. The answer is kept as an accepted source: a new one, or the next
 * of this museum's answers, so the earlier one stays. Nothing here is
 * replaced; location changes go through the history's own rules.
 */
export async function applyPaintingSource(input: z.input<typeof applySchema>): Promise<{ sourceRecordId: string; objectId: string | null; added: string[] } | Failure> {
  const museum = MUSEUMS[museumSchema.parse(input.museum)];
  try {
    const v = applySchema.parse(input);
    const painting = await getPainting(v.paintingId);
    if (!painting) return { error: "Painting not found" };
    if (painting.fingerprint !== v.fingerprint) return { error: "This painting changed since the review. Look it up again." };
    const found = await fetchProviderDetail(museum, v.externalId);
    const review = await buildReview(v.museum, painting, v.objectId, found);
    if (review.locked) return { error: `A locked ${museum.label} source keeps this painting as it is` };
    if (review.object && v.objectFingerprint !== review.object.fingerprint)
      return { error: "The original changed since the review. Look it up again." };
    if (v.location && review.location.action && review.location.action !== "record" && v.historyFingerprint !== review.location.historyFingerprint)
      return { error: "Its location changed since the review. Look it up again." };

    // The answer, kept: the next of this museum's answers, or a first one
    const owner = { kind: "painting" as const, id: painting.id };
    const previous = await previousAnswer(painting.id, v.museum, review.externalId);
    const kept = previous
      ? await refreshSourceObservation({ id: previous.id, expectedRevision: previous.revision, retrievedAt: found.retrievedAt, payload: found.detail.payload })
      : await recordProviderDetail(museum, owner, found);
    await reviewSourceObservation({ id: kept.id, expectedRevision: kept.revision, reviewStatus: "accepted", locked: false, verifiedAt: new Date() });
    const sourceRecordId = kept.id;
    const added: string[] = [];
    const proposals = Object.fromEntries(found.proposals.map((p) => [p.level, p.fields])) as {
      work: { creationDate?: CatalogueDateInput; painter?: { name: string; attribution: string | null } };
      art_object: { owner: { name: string; wikidataId: string }; accessionNumber?: string; dimensions?: Size };
    };

    // The work: an empty date, and the painter, credited as attributed
    const workPatch: Parameters<typeof updatePainting>[1] = {};
    if (v.work.includes("creationDate") && review.work.find((f) => f.field === "creationDate")?.verdict === "fill") {
      workPatch.creationDate = proposals.work.creationDate ?? null;
      // The date's source, unless the person already cited one
      if (!painting.sourceRecordId) workPatch.sourceRecordId = sourceRecordId;
      added.push("Date");
    }
    if (v.painter && review.painter && !review.painter.here) {
      const personId = review.painter.match?.id ?? (await createPerson({ name: review.painter.name, domains: ["painting"] })).id;
      workPatch.credits = [
        ...painting.credits.map((c) => ({ id: c.id, personId: c.personId, roleId: c.roleId, creditedAs: c.creditedAs, attribution: c.attribution, characters: c.characters, notes: c.notes })),
        {
          personId,
          roleId: "painting.painter",
          creditedAs: null,
          attribution: "attributed" as const,
          characters: [],
          notes: `Attributed by ${museum.label}${review.painter.attribution ? `: ${review.painter.attribution}` : ""}`,
        },
      ];
      added.push(review.painter.name);
    }
    if (Object.keys(workPatch).length) await updatePainting(painting.id, workPatch, painting.fingerprint);

    // The owner, when the original's is empty or a new original is added
    const wantsOwner = v.object.includes("owner") && review.objectFields.find((f) => f.field === "owner")?.verdict === "fill";
    let ownerId = review.owner.match?.id ?? null;
    if ((wantsOwner || (v.createObject && !review.object)) && !ownerId) {
      ownerId = (await saveOrganization({ name: proposals.art_object.owner.name, roles: ["museum"] }))!.id;
      await ensureIdentifier("organization", ownerId, proposals.art_object.owner.wikidataId);
    } else if (ownerId && wantsOwner) await ensureIdentifier("organization", ownerId, proposals.art_object.owner.wikidataId);

    const fill = (field: "accessionNumber" | "dimensions") =>
      v.object.includes(field) && review.objectFields.find((f) => f.field === field)?.verdict === "fill";
    const size = proposals.art_object.dimensions;
    let objectId = review.object?.id ?? null;
    if (!review.object && v.createObject && painting.objects.some((o) => o.kind === "original"))
      return { error: "This painting has an original already: choose it, then look it up again" };
    if (!review.object && v.createObject) {
      const created = await createArtObject({
        workId: painting.id,
        kind: "original",
        ownership: "institutional",
        ownerOrganizationId: ownerId,
        accessionNumber: proposals.art_object.accessionNumber ?? null,
        ...(size && { height: size.height, width: size.width, depth: size.depth, dimensionUnit: "cm" as const }),
        sourceRecordId,
      });
      objectId = created.id;
      added.push("The original");
    } else if (review.object) {
      const patch: Parameters<typeof updateArtObject>[1] = {};
      if (fill("accessionNumber")) {
        patch.accessionNumber = proposals.art_object.accessionNumber ?? null;
        added.push("Accession number");
      }
      if (wantsOwner && ownerId) {
        patch.ownership = "institutional";
        patch.ownerOrganizationId = ownerId;
        added.push(proposals.art_object.owner.name);
      }
      if (fill("dimensions") && size) {
        Object.assign(patch, { height: size.height, width: size.width, depth: size.depth, dimensionUnit: "cm" });
        added.push("Size");
      }
      const cited = painting.objects.find((o) => o.id === review.object!.id)?.sourceRecordId;
      if (Object.keys(patch).length)
        await updateArtObject(review.object.id, { ...patch, ...(!cited && { sourceRecordId }) }, review.object.fingerprint);
    }

    // Where it is shown: the museum's dated answer, through the history's own rules
    if (v.location && objectId && review.location.evidence === "on_view" && review.location.venue && !review.locked) {
      const history = (await getWhereabouts(objectId))!;
      const day = found.retrievedAt.toISOString().slice(0, 10).split("-").map(Number);
      const owned = ownerId && (await getArtObject(objectId))?.ownerOrganizationId === ownerId;
      const verifiedAt = found.retrievedAt.toISOString();
      const action = review.object ? review.location.action : "record";
      if (action === "verify" && history.current) {
        // A check, not a new record: its own source stays, and only an unknown display is filled
        await updateWhereabouts(
          history.current.id,
          {
            verifiedAt,
            ...(!history.current.sourceRecordId && { sourceRecordId }),
            ...(history.current.displayStatus === "unknown" && { displayStatus: "on_display" as const }),
          },
          history.fingerprint,
        );
        added.push("Location checked");
      } else if (action === "record" || action === "move") {
        await recordWhereabouts(
          {
            objectId,
            placeKind: "venue",
            venueId: review.location.venue.id,
            custody: owned ? "permanent_collection" : "unknown",
            displayStatus: "on_display",
            certainty: "confirmed",
            // A move starts the day the museum said so; a first record since an unknown day
            startsOn: action === "move" ? { precision: "day", start: { year: day[0], month: day[1], day: day[2] } } : null,
            verifiedAt,
            notes: review.location.says,
            sourceRecordId,
          },
          history.fingerprint,
        );
        added.push(action === "move" ? "A move" : "Location");
      }
    }
    return { sourceRecordId, objectId, added };
  } catch (error) {
    return failure(error, museum.label);
  }
}
