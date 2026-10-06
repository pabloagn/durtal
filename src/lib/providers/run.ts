import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { editions, sourceRecords } from "@/lib/db/schema";
import { ExternalFetchError, serialThrottle } from "@/lib/api/external-fetch";
import { proposeSourcedChanges, sourceOwnerColumn, type SourceOwner } from "@/lib/catalogue/provenance";
import { registerCatalogueIdentifier, recordSourceObservation } from "@/lib/actions/catalogue-provenance";
import { stableStringify } from "@/lib/harmonization/normalize";
import {
  ProviderError,
  providerDetailSchema,
  providerHitSchema,
  type ProviderAdapter,
  type ProviderDetail,
  type ProviderHit,
  type ProviderLevel,
  type ProviderProposal,
  type ProviderQuery,
} from "./contract";
import type { WorkKind } from "@/lib/catalogue/kinds";

/*
 * Calls to providers (SLN-375): each call waits at most the provider's time
 * limit, calls to one provider keep the gap its terms ask for, and every
 * answer is checked against the contract before anything reads it.
 */

const throttles = new Map<string, ReturnType<typeof serialThrottle>>();
function throttle(adapter: ProviderAdapter) {
  let run = throttles.get(adapter.id);
  if (!run) {
    run = serialThrottle(adapter.limits.minIntervalMs);
    throttles.set(adapter.id, run);
  }
  return run;
}

/** One call, in its turn, with the provider's time limit; a late answer is dropped */
async function call<T>(adapter: ProviderAdapter, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return throttle(adapter)(async () => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ProviderError(`${adapter.label} did not answer within ${adapter.limits.timeoutMs / 1000} s`, "timeout"));
      }, adapter.limits.timeoutMs);
    });
    try {
      return await Promise.race([task(controller.signal), late]);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof ExternalFetchError) {
        if (error.timedOut) throw new ProviderError(error.message, "timeout");
        if (error.status === 429) throw new ProviderError(`${adapter.label} asks to wait before the next call`, "rate_limited");
        throw new ProviderError(error.message, "unavailable");
      }
      throw new ProviderError(`${adapter.label} could not be reached`, "unavailable");
    } finally {
      clearTimeout(timer);
    }
  });
}

function requireLevel(adapter: ProviderAdapter, level: string) {
  if (!adapter.levels.some((l) => l === level))
    throw new ProviderError(`${adapter.label} does not describe ${level.replace("_", " ")} records`, "unsupported");
}

/** Search results, checked and cut to the provider's limit */
export async function searchProvider<K extends WorkKind>(adapter: ProviderAdapter<K>, query: ProviderQuery<K>): Promise<ProviderHit[]> {
  requireLevel(adapter, query.level);
  const text = query.text.trim();
  if (!text || text.length > 300) throw new ProviderError("Search for 1 to 300 characters", "invalid");
  const raw = await call(adapter, (signal) => adapter.search({ ...query, text }, { signal }));
  if (!Array.isArray(raw)) throw new ProviderError(`${adapter.label} gave an answer Durtal cannot read`, "invalid");
  const hits: ProviderHit[] = [];
  for (const item of raw) {
    const hit = providerHitSchema.safeParse(item);
    if (hit.success) hits.push(hit.data);
    if (hits.length === adapter.limits.maxResults) break;
  }
  return hits;
}

const MAX_PAYLOAD_BYTES = 1_000_000;

/**
 * One item's detail and the values it proposes. Each proposal names a level
 * the provider describes and only the fields it declares for that level.
 */
export async function fetchProviderDetail<K extends WorkKind>(
  adapter: ProviderAdapter<K>,
  externalId: string,
): Promise<{ detail: ProviderDetail; retrievedAt: Date; proposals: ProviderProposal<ProviderLevel<K>>[] }> {
  const id = externalId.trim();
  if (!id || id.length > 500) throw new ProviderError("Give the provider's own id", "invalid");
  const raw = await call(adapter, (signal) => adapter.detail(id, { signal }));
  const parsed = providerDetailSchema.safeParse(raw);
  if (!parsed.success || parsed.data.externalId !== id)
    throw new ProviderError(`${adapter.label} gave an answer Durtal cannot read`, "invalid");
  if (Buffer.byteLength(stableStringify(parsed.data.payload), "utf8") > MAX_PAYLOAD_BYTES)
    throw new ProviderError(`${adapter.label} sent more than 1 MB for one item`, "invalid");
  const proposals = adapter.normalize(parsed.data);
  for (const proposal of proposals) {
    requireLevel(adapter, proposal.level);
    const allowed: readonly string[] = adapter.fields[proposal.level] ?? [];
    const extra = Object.keys(proposal.fields).filter((field) => !allowed.includes(field));
    if (extra.length) throw new ProviderError(`${adapter.label} proposed fields it does not declare: ${extra.join(", ")}`, "invalid");
  }
  return { detail: parsed.data, retrievedAt: new Date(), proposals };
}

export interface ProviderLocks {
  /** The whole record keeps its values: a locked source or locked metadata */
  record: boolean;
  /** Fields the person locked one by one */
  fields: readonly string[];
}

/**
 * What a proposal may fill and what it may not. A value only fills an empty
 * field. A field that has a value, a locked field or a locked record is a
 * conflict for the person to settle; nothing is replaced on its own.
 */
export function reviewProposal(current: Record<string, unknown>, proposal: ProviderProposal, locks: ProviderLocks) {
  const locked = locks.record ? Object.keys(proposal.fields) : locks.fields;
  return proposeSourcedChanges(current, proposal.fields, locked);
}

/** The owners a provider may describe: its collection's works, and book editions */
function ownerFits(adapter: ProviderAdapter, owner: SourceOwner) {
  return owner.kind === adapter.domain || (adapter.domain === "book" && owner.kind === "edition");
}

/**
 * Keeps a detail as a pending source observation of the record, with the
 * provider's id registered. Nothing on the record changes.
 */
export async function recordProviderDetail(
  adapter: ProviderAdapter,
  owner: SourceOwner,
  found: { detail: ProviderDetail; retrievedAt: Date },
) {
  if (!ownerFits(adapter, owner))
    throw new ProviderError(`${adapter.label} describes ${adapter.domain} records only`, "unsupported");
  const identifier = await registerCatalogueIdentifier({ owner, provider: adapter.id, externalId: found.detail.externalId });
  return recordSourceObservation({
    owner,
    provider: adapter.id,
    identifierId: identifier.id,
    url: found.detail.url,
    attribution: found.detail.attribution,
    retrievedAt: found.retrievedAt,
    reviewStatus: "pending",
    payload: { ...found.detail.payload, ...(found.detail.license ? { license: found.detail.license } : {}) },
  });
}

/**
 * The locks a provider meets on a record: a locked observation of this
 * provider (the person kept their version), and locked edition metadata.
 */
export async function providerLocks(owner: SourceOwner, providerId: string): Promise<ProviderLocks> {
  const column = sourceOwnerColumn(owner.kind);
  const [lockedSource] = await db
    .select({ id: sourceRecords.id })
    .from(sourceRecords)
    .where(
      and(
        eq(sourceRecords.entityKind, owner.kind),
        sql`${sql.identifier(column)} = ${owner.id}::uuid`,
        eq(sourceRecords.provider, providerId),
        eq(sourceRecords.locked, true),
      ),
    )
    .limit(1);
  let record = !!lockedSource;
  if (!record && owner.kind === "edition") {
    const edition = await db.query.editions.findFirst({ where: eq(editions.id, owner.id), columns: { metadataLocked: true } });
    record = !!edition?.metadataLocked;
  }
  return { record, fields: [] };
}
