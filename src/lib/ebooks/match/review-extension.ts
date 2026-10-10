import { sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import type { Db } from "@/lib/catalogue/work-store";
import { assertSql, resultRows } from "@/lib/harmonization/store";
import {
  reviewOperationSchema, reviewTimestampSchema, type ReviewOperation,
} from "@/lib/validations/ebook-review";
import {
  canonicalReviewJson, readReviewReceiptRecord, reviewPayloadHash,
  reviewUndoOperationId, REVIEW_RECEIPT_EVENTS,
} from "../review/receipts";
import type { MatchOperationIdentity } from "./types";
import type { LoadedMatchCatalogue } from "./load";

export interface ReviewCompensation {
  readonly originalOperation: MatchOperationIdentity;
  readonly compensationOperationId: string;
  readonly originalAfterUpdatedAt: string;
}
export type CoreWriter = "link" | "accession" | "decision" | "classification" | "undo_link";
export interface MatchAtomicBinding {
  readonly coreWriter: CoreWriter;
  readonly coreOperation: MatchOperationIdentity;
  readonly ebookIds: readonly string[];
  readonly reviewOperations: readonly ReviewOperation[];
  readonly purpose: "decision" | "compensation";
  readonly compensation?: ReviewCompensation;
}
export interface MatchAtomicExtension {
  readonly extraTables: readonly string[];
  before(d: Db): readonly unknown[];
  after(d: Db): readonly unknown[];
}
const preparedExtension: unique symbol = Symbol("prepared matching review extension");
export interface PreparedMatchAtomicExtension extends MatchAtomicExtension {
  readonly [preparedExtension]: true;
}
const prepared = new WeakSet<object>();
const bindings = new WeakMap<object, MatchAtomicBinding>();
const compensationSchema = z.strictObject({
  originalOperation: reviewOperationSchema,
  compensationOperationId: z.uuid().transform((value) => value.toLowerCase()),
  originalAfterUpdatedAt: reviewTimestampSchema,
});
export function parseReviewCompensation(input: unknown): ReviewCompensation {
  const policy = compensationSchema.parse(input);
  if (policy.compensationOperationId !== reviewUndoOperationId(policy.originalOperation))
    throw new Error("Compensation identity does not bind its original operation");
  return policy;
}
function operationIdentity(input: MatchOperationIdentity): ReviewOperation {
  return reviewOperationSchema.parse({
    version: input.version, operationId: input.operationId, runId: input.runId,
    planSha256: input.planSha256, targetDatabase: input.targetDatabase,
  });
}
function validatedBinding(input: MatchAtomicBinding): MatchAtomicBinding {
  if (!["link", "accession", "decision", "classification", "undo_link"].includes(input.coreWriter) ||
      !["decision", "compensation"].includes(input.purpose))
    throw new Error("Unknown matching review writer or purpose");
  const coreOperation = operationIdentity(input.coreOperation);
  const ebookIds = input.ebookIds.map((id) => z.uuid().parse(id).toLowerCase());
  const reviewOperations = input.reviewOperations.map((operation) => reviewOperationSchema.parse(operation));
  const compensation = input.compensation === undefined ? undefined : parseReviewCompensation(input.compensation);
  if (!ebookIds.length || ebookIds.length > 50 || new Set(ebookIds).size !== ebookIds.length ||
      reviewOperations.length !== ebookIds.length ||
      new Set(reviewOperations.map((operation) => operation.operationId)).size !== reviewOperations.length ||
      reviewOperations.some((operation) => operation.targetDatabase !== coreOperation.targetDatabase ||
        operation.runId !== coreOperation.runId) ||
      (input.coreWriter !== "accession" && ebookIds.length !== 1))
    throw new Error("Review extension has an incomplete or mismatched entity scope");
  if ((input.purpose === "compensation") !== !!compensation ||
      (input.coreWriter === "undo_link" && input.purpose !== "compensation"))
    throw new Error("Review extension has the wrong compensation purpose");
  if (compensation) {
    const operation = reviewOperations[0];
    if (ebookIds.length !== 1 || !["undo_link", "classification"].includes(input.coreWriter) ||
        compensation.originalOperation.targetDatabase !== coreOperation.targetDatabase ||
        compensation.originalOperation.runId !== coreOperation.runId ||
        operation.operationId !== compensation.compensationOperationId ||
        operation.planSha256 !== compensation.originalOperation.planSha256)
      throw new Error("Review compensation policy differs from the prepared operation");
    Object.freeze(compensation.originalOperation);
    Object.freeze(compensation);
  }
  return Object.freeze({
    coreWriter: input.coreWriter, coreOperation: Object.freeze(coreOperation),
    ebookIds: Object.freeze(ebookIds),
    reviewOperations: Object.freeze(reviewOperations.map((operation) => Object.freeze(operation))),
    purpose: input.purpose, ...(compensation ? { compensation } : {}),
  });
}
function synchronousQueries(builder: (d: Db) => readonly unknown[], d: Db): readonly unknown[] {
  const queries = builder(d);
  if (!Array.isArray(queries) || typeof (queries as unknown as { then?: unknown }).then === "function")
    throw new Error("Review query builders must synchronously return arrays");
  // Query objects inside the array are ordinarily thenable Drizzle queries.
  return queries;
}
/** Internal server issuer: only the reviewed review/store.ts may call this in product code.
 * The registry, rather than the exported type or copied symbol, proves issuance.
 * Receipt construction and in-transaction final validation remain the store's responsibility. */
export function prepareMatchAtomicExtension(
  binding: MatchAtomicBinding, queries: MatchAtomicExtension,
): PreparedMatchAtomicExtension {
  const frozenBinding = validatedBinding(binding);
  if (!Array.isArray(queries.extraTables) || queries.extraTables.some((table) => table !== "activity_events") ||
      new Set(queries.extraTables).size !== queries.extraTables.length ||
      !queries.extraTables.includes("activity_events") ||
      typeof queries.before !== "function" || typeof queries.after !== "function" ||
      queries.before.constructor.name === "AsyncFunction" || queries.after.constructor.name === "AsyncFunction")
    throw new Error("Review extension requires synchronous builders and the activity table");
  const before = queries.before.bind(queries), after = queries.after.bind(queries);
  const extension: PreparedMatchAtomicExtension = Object.freeze({
    [preparedExtension]: true as const,
    extraTables: Object.freeze([...queries.extraTables]),
    before: (d: Db) => synchronousQueries(before, d),
    after: (d: Db) => synchronousQueries(after, d),
  });
  prepared.add(extension);
  bindings.set(extension, frozenBinding);
  return extension;
}
/** Called before reservations/covers and again before building a single atomic query list. */
export function requireMatchAtomicExtension(
  extension: PreparedMatchAtomicExtension | undefined,
  expected: Pick<MatchAtomicBinding, "coreWriter" | "coreOperation" | "ebookIds"> & {
    compensation?: ReviewCompensation;
  },
): PreparedMatchAtomicExtension | undefined {
  if (extension === undefined) {
    if (expected.compensation !== undefined) throw new Error("Review compensation requires its trusted extension");
    return undefined;
  }
  if (!prepared.has(extension)) throw new Error("Untrusted matching review extension");
  const binding = bindings.get(extension)!;
  const compensation = expected.compensation === undefined ? undefined : parseReviewCompensation(expected.compensation);
  if (binding.coreWriter !== expected.coreWriter ||
      canonicalReviewJson(binding.coreOperation) !== canonicalReviewJson(operationIdentity(expected.coreOperation)) ||
      canonicalReviewJson([...binding.ebookIds].sort()) !== canonicalReviewJson([...expected.ebookIds].sort()) ||
      binding.purpose !== (compensation ? "compensation" : "decision") ||
      (!!binding.compensation !== !!compensation) ||
      (compensation && canonicalReviewJson(binding.compensation) !== canonicalReviewJson(compensation)))
    throw new Error("Review extension differs from the frozen writer plan, scope or policy");
  return extension;
}

/** Reads the authoritative original on the supplied protected planning connection.
 * Decided states have no candidates, so the pure hash of [] is the exact after hash. */
export async function verifyReviewCompensationOn(
  conn: Db, input: ReviewCompensation, ebookId: string,
  actions: readonly ("accept" | "link" | "accession" | "keep" | "exclude")[],
  snapshot: Pick<LoadedMatchCatalogue, "rows">,
): Promise<ReviewCompensation> {
  const policy = parseReviewCompensation(input);
  const rows = resultRows<{ row: Record<string, unknown>; updatedAt: string }>(await conn.execute(sql`
    select to_jsonb(a) row,
      to_char(e.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "updatedAt"
    from activity_events a join ebooks e on e.id=${ebookId}::uuid
    where a.id=${policy.originalOperation.operationId}::uuid`));
  if (rows.length !== 1) throw new Error("The original review receipt is missing");
  const raw = rows[0].row;
  const original = readReviewReceiptRecord({
    id: raw.id, entityType: raw.entity_type, entityId: raw.entity_id,
    eventKey: raw.event_key, metadata: raw.metadata,
  });
  const current = snapshot.rows.ebooks.find((row) => row.id === ebookId);
  if (original.entityType !== "ebook" || original.action === "undo" ||
      !actions.includes(original.action as typeof actions[number]) ||
      original.entityId !== ebookId ||
      canonicalReviewJson(original.operation) !== canonicalReviewJson(policy.originalOperation) ||
      original.after.updatedAt !== policy.originalAfterUpdatedAt || !current ||
      snapshot.rows.ebook_match_candidates.some((row) => row.ebook_id === ebookId) ||
      canonicalReviewJson(original.after) !== canonicalReviewJson({
        matchState: current.match_state, matchTier: current.match_tier ?? null,
        matchFingerprint: current.match_fingerprint ?? null, updatedAt: rows[0].updatedAt,
        instanceId: current.instance_id ?? null, exclusionReason: current.exclusion_reason ?? null,
        candidatesHash: reviewPayloadHash([]),
      }))
    throw new Error("Review compensation requires the original decision's exact after-state");
  return policy;
}

/** These guards supplement the store's full strict receipt predicate. NULL fails closed. */
export function reviewCompensationGuardQueries(
  d: Db, policy: ReviewCompensation, ebookId: string,
  actions: readonly string[],
): unknown[] {
  const original = policy.originalOperation;
  return [d.execute(assertSql(sql`(exists (
    select 1 from activity_events a join ebooks e on e.id=${ebookId}::uuid
    where a.id=${original.operationId}::uuid and a.entity_type='ebook'
      and a.entity_id=${ebookId}::uuid and a.event_key=${REVIEW_RECEIPT_EVENTS.ebookDecision}
      and a.metadata #> '{extra,ebookReview,operation}'=${JSON.stringify(original)}::jsonb
      and a.metadata #>> '{extra,ebookReview,entityType}'='ebook'
      and a.metadata #>> '{extra,ebookReview,entityId}'=${ebookId}
      and a.metadata #>> '{extra,ebookReview,eventKey}'=${REVIEW_RECEIPT_EVENTS.ebookDecision}
      and a.metadata #> '{extra,ebookReview,originalOperation}'='null'::jsonb
      and a.metadata #>> '{extra,ebookReview,action}'=any(${[...actions]}::text[])
      and a.metadata #>> '{extra,ebookReview,after,updatedAt}'=${policy.originalAfterUpdatedAt}
      and isfinite((a.metadata #>> '{extra,ebookReview,after,updatedAt}')::timestamptz)
      and to_char((a.metadata #>> '{extra,ebookReview,after,updatedAt}')::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=${policy.originalAfterUpdatedAt}
      and isfinite(e.updated_at)
      and to_char(e.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')=${policy.originalAfterUpdatedAt}
      and a.metadata #> '{extra,ebookReview,after,matchState}'=to_jsonb(e.match_state)
      and a.metadata #> '{extra,ebookReview,after,matchTier}'=coalesce(to_jsonb(e.match_tier),'null'::jsonb)
      and a.metadata #> '{extra,ebookReview,after,matchFingerprint}'=coalesce(to_jsonb(e.match_fingerprint),'null'::jsonb)
      and a.metadata #> '{extra,ebookReview,after,instanceId}'=coalesce(to_jsonb(e.instance_id),'null'::jsonb)
      and a.metadata #> '{extra,ebookReview,after,exclusionReason}'=coalesce(to_jsonb(e.exclusion_reason),'null'::jsonb)
      and a.metadata #>> '{extra,ebookReview,after,candidatesHash}'=${reviewPayloadHash([])}
      and not exists(select 1 from ebook_match_candidates c where c.ebook_id=e.id)
  )) IS TRUE`, "Original review receipt or exact after-state changed"))];
}
/** Evaluated only after the guarded original receipt and current row are locked. */
export function reviewForwardUpdatedAt(policy: ReviewCompensation): SQL {
  return sql`greatest(clock_timestamp(), ebooks.updated_at + interval '1 microsecond',
    (select (a.metadata #>> '{extra,ebookReview,after,updatedAt}')::timestamptz
     from activity_events a where a.id=${policy.originalOperation.operationId}::uuid)
     + interval '1 microsecond')`;
}
