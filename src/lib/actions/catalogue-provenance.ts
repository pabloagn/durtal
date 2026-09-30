"use server";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { catalogueIdentifiers, sourceRecords } from "@/lib/db/schema";
import {
  ownerColumns,
  providerSchema,
  sourceOwnerSchema,
  sourceUrlSchema,
  type SourceOwner,
} from "@/lib/catalogue/provenance";
import { stableStringify } from "@/lib/harmonization/normalize";
import { assertSql, resultRows } from "@/lib/harmonization/store";

function ownerWhere(
  owner: SourceOwner,
  table: typeof catalogueIdentifiers | typeof sourceRecords,
) {
  const column =
    owner.kind === "edition"
      ? table.editionId
      : owner.kind === "person"
        ? table.personId
        : owner.kind === "organization"
          ? table.organizationId
          : owner.kind === "venue"
            ? table.venueId
            : table.workId;
  return and(eq(table.entityKind, owner.kind), eq(column, owner.id))!;
}
const identifierSchema = z.object({
  owner: sourceOwnerSchema,
  provider: providerSchema,
  externalId: z.string().trim().min(1).max(500),
});

/** Idempotent for the same owner; an identifier cannot claim another identity. */
export async function registerCatalogueIdentifier(
  input: z.input<typeof identifierSchema>,
) {
  const { owner, provider, externalId } = identifierSchema.parse(input);
  const [row] = await db
    .insert(catalogueIdentifiers)
    .values({ ...ownerColumns(owner), provider, externalId })
    .onConflictDoUpdate({
      target: [
        catalogueIdentifiers.provider,
        catalogueIdentifiers.entityKind,
        catalogueIdentifiers.externalId,
      ],
      set: { externalId },
      setWhere: ownerWhere(owner, catalogueIdentifiers),
    })
    .returning();
  if (!row)
    throw new Error(
      "This provider identifier already belongs to another catalogue record",
    );
  return row;
}

const observationSchema = z
  .object({
    owner: sourceOwnerSchema,
    provider: providerSchema,
    identifierId: z.uuid().nullable().default(null),
    url: sourceUrlSchema.nullable().default(null),
    attribution: z.string().trim().min(1).max(1000).nullable().default(null),
    retrievedAt: z.date(),
    verifiedAt: z.date().nullable().default(null),
    payload: z.record(z.string(), z.json()),
  })
  .refine(
    (v) => !v.verifiedAt || v.verifiedAt >= v.retrievedAt,
    "Verification cannot precede retrieval",
  );

function observationPayload(payload: Record<string, unknown>) {
  const json = stableStringify(payload);
  if (Buffer.byteLength(json, "utf8") > 1_000_000)
    throw new Error("A source observation must be at most 1 MB");
  return {
    payload,
    payloadHash: createHash("sha256").update(json).digest("hex"),
  };
}

/** Record a source, without promoting any provider fields to canonical metadata. */
export async function recordSourceObservation(
  input: z.input<typeof observationSchema>,
) {
  const { owner, payload, ...fields } = observationSchema.parse(input);
  const [row] = await db
    .insert(sourceRecords)
    .values({
      ...ownerColumns(owner),
      ...fields,
      ...observationPayload(payload),
    })
    .returning();
  return row;
}

const refreshSchema = z.object({
  id: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  retrievedAt: z.date(),
  payload: z.record(z.string(), z.json()),
});

/** Append one unreviewed successor. Locks, stale editors and competing refreshes fail atomically. */
export async function refreshSourceObservation(
  input: z.input<typeof refreshSchema>,
) {
  const parsed = refreshSchema.parse(input);
  const previous = await db.query.sourceRecords.findFirst({
    where: eq(sourceRecords.id, parsed.id),
  });
  if (!previous) throw new Error("Source observation not found");
  const id = randomUUID();
  await atomic((d) => [
    d.execute(
      sql`select id from source_records where id=${parsed.id}::uuid for update`,
    ),
    d.execute(
      assertSql(
        sql`exists (select 1 from source_records where id=${parsed.id}::uuid and revision=${parsed.expectedRevision} and not locked)`,
        "Source observation is locked, missing or changed; reload before refreshing",
      ),
    ),
    d.insert(sourceRecords).values({
      id,
      entityKind: previous.entityKind,
      workId: previous.workId,
      editionId: previous.editionId,
      personId: previous.personId,
      organizationId: previous.organizationId,
      venueId: previous.venueId,
      provider: previous.provider,
      identifierId: previous.identifierId,
      url: previous.url,
      attribution: previous.attribution,
      retrievedAt: parsed.retrievedAt,
      supersedesId: previous.id,
      ...observationPayload(parsed.payload),
    }),
  ]);
  return (await db.query.sourceRecords.findFirst({
    where: eq(sourceRecords.id, id),
  }))!;
}

const reviewSchema = z.object({
  id: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  reviewStatus: z.enum(["pending", "accepted", "rejected"]),
  locked: z.boolean(),
  verifiedAt: z.date().nullable(),
});
export async function reviewSourceObservation(
  input: z.input<typeof reviewSchema>,
) {
  const { id, expectedRevision, ...fields } = reviewSchema.parse(input);
  const [row] = await db
    .update(sourceRecords)
    .set(fields)
    .where(
      and(
        eq(sourceRecords.id, id),
        eq(sourceRecords.revision, expectedRevision),
      ),
    )
    .returning();
  if (!row)
    throw new Error(
      "Source observation changed or no longer exists; reload before reviewing",
    );
  return row;
}

/** Keep historic provider strings/IDs verbatim: their namespace may be ambiguous. */
async function legacyProvenance(owner: SourceOwner) {
  const query =
    owner.kind === "book"
      ? sql`select metadata_source as provider, metadata_source_id as "externalId", null::timestamptz as "retrievedAt", false as locked from works where id=${owner.id}::uuid and kind='book'`
      : owner.kind === "edition"
        ? sql`select metadata_source as provider, null::text as "externalId", metadata_last_fetched as "retrievedAt", metadata_locked as locked from editions where id=${owner.id}::uuid`
        : owner.kind === "person"
          ? sql`select metadata_source as provider, metadata_source_id as "externalId", null::timestamptz as "retrievedAt", false as locked from authors where id=${owner.id}::uuid`
          : null;
  if (!query) return null;
  const row = resultRows<{
    provider: string | null;
    externalId: string | null;
    retrievedAt: string | Date | null;
    locked: boolean;
  }>(await db.execute(query))[0];
  return row
    ? {
        ...row,
        retrievedAt: row.retrievedAt ? new Date(row.retrievedAt) : null,
      }
    : null;
}

const listSchema = z.object({
  owner: sourceOwnerSchema,
  limit: z.number().int().min(1).max(100).default(30),
  offset: z.number().int().nonnegative().default(0),
});
export async function getCatalogueProvenance(
  input: z.input<typeof listSchema>,
) {
  const { owner, limit, offset } = listSchema.parse(input);
  const [identifiers, observations, legacy] = await Promise.all([
    db
      .select()
      .from(catalogueIdentifiers)
      .where(ownerWhere(owner, catalogueIdentifiers))
      .orderBy(
        catalogueIdentifiers.provider,
        catalogueIdentifiers.externalId,
        catalogueIdentifiers.id,
      ),
    db
      .select()
      .from(sourceRecords)
      .where(ownerWhere(owner, sourceRecords))
      .orderBy(desc(sourceRecords.retrievedAt), desc(sourceRecords.id))
      .limit(limit + 1)
      .offset(offset),
    legacyProvenance(owner),
  ]);
  return {
    identifiers,
    observations: observations.slice(0, limit),
    hasMore: observations.length > limit,
    legacy,
  };
}
