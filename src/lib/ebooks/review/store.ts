import { textArraySql, uuidArraySql } from "@/lib/db/sql-arrays";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import type { Db } from "@/lib/catalogue/work-store";
import { atomicOn } from "@/lib/db/atomic";
import { assertSql, lockSql, resultRows } from "@/lib/harmonization/store";
import {
  reviewOperationSchema, reviewHashSchema, reviewDecisionRequestSchema,
  undoEbookDecisionSchema, type ReviewOperation, type ReviewDecisionRequest,
} from "@/lib/validations/ebook-review";
import { immutableMatchingWriterInput, type LinkReceipt } from "../match/link";
import {
  prepareMatchAtomicExtension, type MatchAtomicBinding,
  type PreparedMatchAtomicExtension, type ReviewCompensation,
} from "../match/review-extension";
import {
  canonicalReviewJson, ebookReviewReceiptSeedSchema, ebookReviewSnapshotSchema,
  readReviewReceiptRecord, reviewPayloadHash, reviewRequestHash, reviewUndoOperationId,
  verifyReviewRetry, verifyReviewUndoRetry, REVIEW_RECEIPT_EVENTS, type ReviewReceipt,
} from "./receipts";
import {
  activityRawSnapshotSql, actualAfterIsValidSql, candidateTextsSql,
  ebookRawSnapshotSql, ebookSnapshotSql, ebookSnapshotTimesAreValidSql,
  reviewTimestampIsValidSql, REVIEW_RESULT_MARKER,
} from "./store-sql";
import { ReviewError, REVIEW_SQL_ERRORS } from "./errors";
import { matchingOperationOf, parseReviewUnlinkPolicy, type ReviewUnlinkPlan } from "./unlink-contract";

export type EbookReceipt = Extract<ReviewReceipt, { entityType: "ebook" }>;
export type EbookSnapshot = EbookReceipt["before"];
export type DecisionRequest = z.output<typeof reviewDecisionRequestSchema>;
export type ReceiptSeed = Omit<EbookReceipt, "after">;
export type UndoRequest = z.output<typeof undoEbookDecisionSchema>;
export interface ActivityReviewRow {
  readonly id: string; readonly entityType: "ebook"; readonly entityId: string; readonly eventKey: string;
  readonly metadata: { readonly extra: { readonly ebookReview: EbookReceipt } };
}
export interface VerifiedReviewRecord {
  readonly row: ActivityReviewRow;
  readonly receipt: EbookReceipt;
  readonly rawSnapshotText: string;
}
export interface ReviewBeforeRead {
  readonly ebookId: string;
  readonly snapshot: EbookSnapshot;
  readonly rawEbookSnapshotText: string;
  readonly candidateSnapshotTexts: readonly string[];
  readonly matchingLinkReceipt: LinkReceipt | null;
}
export interface PreparedReviewAtomicWrite {
  readonly extension: PreparedMatchAtomicExtension;
  readCommitted(atomicResults: readonly unknown[]): readonly EbookReceipt[];
}
export interface ReviewWriteInput {
  readonly binding: MatchAtomicBinding;
  readonly requests: readonly DecisionRequest[];
  readonly beforeReads: readonly ReviewBeforeRead[];
  readonly seeds: readonly ReceiptSeed[];
  readonly frozenEnvelopeHash: string;
}
export interface CompensationWriteInput {
  readonly binding: MatchAtomicBinding;
  readonly original: VerifiedReviewRecord;
  readonly before: ReviewBeforeRead;
  readonly seed: ReceiptSeed;
  readonly frozenEnvelopeHash: string;
}
export interface CompensationPreparation {
  readonly original: VerifiedReviewRecord;
  readonly replay: VerifiedReviewRecord | null;
  readonly before: ReviewBeforeRead | null;
  readonly policy: ReviewCompensation;
  readonly operation: ReviewOperation;
}
const uuid = z.uuid().transform((id) => id.toLowerCase());
const same = (a: unknown, b: unknown) => canonicalReviewJson(a) === canonicalReviewJson(b);
const afterStates = {
  accept: "linked", link: "linked", accession: "linked", keep: "standalone",
  exclude: "excluded", restore: "pending", rematch: "pending",
} as const;
export const allowedReviewBefore = {
  accept: ["pending"], link: ["pending", "standalone"], accession: ["pending", "standalone"],
  keep: ["pending"], exclude: ["pending", "standalone"], restore: ["standalone", "excluded"],
  rematch: ["pending"],
} as const;
export type SupportedDecision = Exclude<ReviewDecisionRequest, { action: "mark_accessioned" | "unlink" }>;
export function supportedDecision(input: unknown): SupportedDecision {
  const request = reviewDecisionRequestSchema.parse(input);
  if (request.action === "mark_accessioned" || request.action === "unlink")
    throw new ReviewError("unsupported_action", "This review action is not supported.");
  return request;
}
export function assertEligible(action: SupportedDecision["action"], before: EbookSnapshot): void {
  if (!(allowedReviewBefore[action] as readonly string[]).includes(before.matchState))
    throw new ReviewError("ineligible_state", "This eBook is no longer eligible for that decision.");
}
function receiptRowSql() {
  return sql`a.id,a.entity_type as "entityType",a.entity_id as "entityId",
    a.event_key as "eventKey",a.metadata`;
}
/** Null means the global activity key is absent, never a malformed/other namespace row. */
export async function readReviewReceiptOn(conn: Db, operationId: string): Promise<VerifiedReviewRecord | null> {
  const id = uuid.parse(operationId);
  const rows = resultRows<ActivityReviewRow & { rawSnapshotText: string; snapshotValid: boolean }>(await conn.execute(sql`
    select ${receiptRowSql()},${activityRawSnapshotSql()} as "rawSnapshotText",
      ${reviewTimestampIsValidSql(sql`a.created_at`)} as "snapshotValid"
    from activity_events a where a.id=${id}::uuid`));
  if (!rows.length) return null;
  try {
    const row = rows[0];
    if (!row.snapshotValid) throw new Error("Unrepresentable audit timestamp");
    const receipt = readReviewReceiptRecord(row);
    if (receipt.entityType !== "ebook") throw new Error("Different namespace");
    return immutableMatchingWriterInput({
      row: { id: row.id, entityType: "ebook", entityId: row.entityId,
        eventKey: row.eventKey, metadata: row.metadata },
      receipt, rawSnapshotText: row.rawSnapshotText,
    });
  } catch (cause) {
    throw new ReviewError("operation_collision", "This operation key belongs to another record.", { cause });
  }
}
export async function readReviewBeforeOn(conn: Db, ebookId: string): Promise<ReviewBeforeRead | null> {
  const id = uuid.parse(ebookId);
  const rows = resultRows<ReviewBeforeRead & { snapshotValid: boolean }>(await conn.execute(sql`
    select e.id as "ebookId", ${ebookSnapshotSql()} as snapshot,
      ${ebookRawSnapshotSql()} as "rawEbookSnapshotText",
      ${candidateTextsSql(sql`e.id`)} as "candidateSnapshotTexts",
      e.link_written as "matchingLinkReceipt",${ebookSnapshotTimesAreValidSql()} as "snapshotValid"
    from ebooks e where e.id=${id}::uuid`));
  if (!rows.length) return null;
  if (!rows[0].snapshotValid)
    throw new ReviewError("invalid_receipt", "The eBook has an invalid database version.");
  const { snapshotValid: _snapshotValid, ...row } = rows[0];
  const snapshot = ebookReviewSnapshotSchema.parse(row.snapshot);
  if (snapshot.candidatesHash !== reviewPayloadHash(row.candidateSnapshotTexts))
    throw new ReviewError("invalid_receipt", "Candidate snapshot hashing differs from the database.");
  return immutableMatchingWriterInput({ ...row, snapshot });
}
function validateSeed(input: ReceiptSeed, before: ReviewBeforeRead, binding: MatchAtomicBinding): ReceiptSeed {
  const seed = ebookReviewReceiptSeedSchema.parse(input);
  if (seed.entityId !== before.ebookId || !same(seed.before, before.snapshot) ||
      !binding.ebookIds.includes(seed.entityId) ||
      !binding.reviewOperations.some((op) => same(op, seed.operation)))
    throw new ReviewError("invalid_receipt", "Receipt seed differs from its prepared operation.");
  if ((seed.action === "undo") !== (seed.originalOperation !== null) ||
      seed.eventKey !== (seed.action === "undo" ? REVIEW_RECEIPT_EVENTS.ebookUndo : REVIEW_RECEIPT_EVENTS.ebookDecision))
    throw new ReviewError("invalid_receipt", "Receipt namespace does not bind its action.");
  return seed;
}
function validateVerifiedRecord(record: VerifiedReviewRecord): void {
  const raw = JSON.parse(record.rawSnapshotText) as Record<string, unknown>;
  const row = { id: raw.id, entityType: raw.entity_type, entityId: raw.entity_id,
    eventKey: raw.event_key, metadata: raw.metadata };
  const parsed = readReviewReceiptRecord(row);
  if (!same(row, record.row) || !same(parsed, record.receipt))
    throw new ReviewError("invalid_receipt", "The verified record differs from its database snapshot.");
}
function verifiedRetry(stored: VerifiedReviewRecord, request: ReviewDecisionRequest): EbookReceipt {
  try {
    validateVerifiedRecord(stored);
    const receipt = verifyReviewRetry(stored.row, request);
    if (receipt.entityType !== "ebook") throw new Error("Different namespace");
    return receipt;
  } catch (cause) {
    throw new ReviewError("operation_collision", "This operation key belongs to another request.", { cause });
  }
}
function verifiedUndo(stored: VerifiedReviewRecord, original: VerifiedReviewRecord): EbookReceipt {
  try {
    validateVerifiedRecord(stored);
    validateVerifiedRecord(original);
    const receipt = verifyReviewUndoRetry(stored.row, original.row);
    if (receipt.entityType !== "ebook") throw new Error("Different namespace");
    return receipt;
  } catch (cause) {
    throw new ReviewError("operation_collision", "This compensation belongs to another decision.", { cause });
  }
}
function expectedReceiptSql(seed: ReceiptSeed) {
  return sql`(${JSON.stringify(seed)}::jsonb || jsonb_build_object('after',${ebookSnapshotSql()}))`;
}
interface Entry {
  seed: ReceiptSeed;
  before: ReviewBeforeRead;
  request?: SupportedDecision | UnlinkRequest;
  original?: VerifiedReviewRecord;
  unlinkPlan?: ReviewUnlinkPlan;
}
export type UnlinkRequest = Extract<ReviewDecisionRequest, { action: "unlink" }>;
export function reviewUnlinkEffectHash(plan: ReviewUnlinkPlan): string {
  return reviewPayloadHash({ policy: plan.reviewUnlink, cleanup: plan.cleanup, classification: plan.classification });
}
/** Final checks run after the audit insert, so its triggers cannot silently
 * change metadata, restore a link or replace the displayed classification. */
function unlinkFinalStateSql(plan: ReviewUnlinkPlan, before: ReviewBeforeRead) {
  const result = plan.classification;
  const changed = ["updated_at", "instance_id", "match_state", "match_method", "match_probability",
    "matched_at", "link_written", "match_tier", "duplicate_of_id", "exclusion_reason",
    "match_fingerprint", "match_model_version"];
  return sql`((${ebookRawSnapshotSql()}::jsonb - ${textArraySql(changed)}) =
      (${before.rawEbookSnapshotText}::jsonb - ${textArraySql(changed)})
    and e.instance_id is null and e.link_written is null and e.match_method is null
    and e.match_probability is null and e.matched_at is null and e.exclusion_reason is null
    and e.match_fingerprint=${result.fingerprint}
    and e.match_tier is not distinct from ${result.tier}
    and e.match_model_version=${result.modelVersion}
    and e.duplicate_of_id is not distinct from ${result.duplicateOfId}::uuid
    and (select count(*) from ebook_match_candidates c where c.ebook_id=e.id)=${result.candidates.length}
    ${sql.join(result.candidates.map((candidate) => sql`and exists(select 1 from ebook_match_candidates c
      where c.ebook_id=e.id and c.rank=${candidate.rank} and c.work_id=${candidate.workId}::uuid
        and c.edition_id is not distinct from ${candidate.effect.editionId}::uuid
        and c.instance_id is not distinct from ${candidate.effect.movedFromEditionId ? null : candidate.effect.instanceId}::uuid
        and c.edition_rule=${candidate.effect.rule} and c.probability=${candidate.probability}::real
        and c.weight_bits=${candidate.weightBits}::real
        and c.margin_bits is not distinct from ${candidate.marginBits}::real
        and c.reasons=${JSON.stringify([...candidate.reasons, ...candidate.effect.ambiguities,
          ...(candidate.effect.movedFromEditionId ? [{ code: "move_copy", text: candidate.effect.text }] : [])])}::jsonb
        and c.flags=${textArraySql(candidate.flags)} and c.model_version=${result.modelVersion}
        and c.created_at=${plan.createdAt}::timestamptz)`), sql` `)}
  ) IS TRUE`;
}
function preparedWrite(binding: MatchAtomicBinding, entries: readonly Entry[]): PreparedReviewAtomicWrite {
  const ids = entries.map(({ seed }) => seed.operation.operationId);
  if (!entries.length || entries.length > 50 || new Set(ids).size !== ids.length ||
      new Set(entries.map(({ seed }) => seed.entityId)).size !== entries.length ||
      !same([...binding.ebookIds].sort(), entries.map(({ seed }) => seed.entityId).sort()))
    throw new ReviewError("invalid_receipt", "Receipt scope is incomplete or duplicated.");
  const extension = prepareMatchAtomicExtension(binding, {
    extraTables: ["activity_events"],
    before: (d) => entries.flatMap(({ seed, before, original }) => [
      d.execute(assertSql(sql`(not exists(select 1 from activity_events where id=${seed.operation.operationId}::uuid))
        IS TRUE`, REVIEW_SQL_ERRORS.collision)),
      d.execute(assertSql(sql`(exists(select 1 from ebooks e where e.id=${seed.entityId}::uuid
        and ${ebookSnapshotTimesAreValidSql()}
        and ${ebookRawSnapshotSql()}=${before.rawEbookSnapshotText}
        and ${ebookSnapshotSql()}=${JSON.stringify(seed.before)}::jsonb
        and ${candidateTextsSql(sql`e.id`)}=${JSON.stringify(before.candidateSnapshotTexts)}::jsonb))
        IS TRUE`, REVIEW_SQL_ERRORS.stale)),
      ...(original ? [d.execute(assertSql(sql`(exists(select 1 from activity_events a
        where a.id=${original.receipt.operation.operationId}::uuid
          and ${reviewTimestampIsValidSql(sql`a.created_at`)}
          and ${activityRawSnapshotSql()}=${original.rawSnapshotText}
          and a.metadata #> '{extra,ebookReview,after}'=${JSON.stringify(seed.before)}::jsonb))
        IS TRUE`, REVIEW_SQL_ERRORS.stale))] : []),
    ]),
    after: (d) => [
      // Every receipt is captured before validation. A later insert trigger
      // may alter an earlier receipt/ebook; recheck ALL final states afterward.
      ...entries.map(({ seed }) =>
        d.execute(sql`insert into activity_events(id,entity_type,entity_id,event_key,metadata)
          select ${seed.operation.operationId}::uuid,'ebook',e.id,${seed.eventKey},
            jsonb_build_object('extra',jsonb_build_object('ebookReview',${expectedReceiptSql(seed)}))
          from ebooks e where e.id=${seed.entityId}::uuid`)),
      ...entries.map(({ seed, request, original, unlinkPlan, before }) => {
        const afterState = seed.action === "undo" || seed.action === "unlink" ? "pending" : afterStates[seed.action as keyof typeof afterStates];
        return d.execute(assertSql(sql`(exists(select 1 from activity_events a join ebooks e on e.id=${seed.entityId}::uuid
            where a.id=${seed.operation.operationId}::uuid and a.entity_type='ebook'
              and a.entity_id=e.id and a.event_key=${seed.eventKey}
              and a.metadata #> '{extra,ebookReview}'=${expectedReceiptSql(seed)}
              and ${reviewTimestampIsValidSql(sql`a.created_at`)}
              and ${actualAfterIsValidSql()}
              and e.match_state=${afterState}
              and e.updated_at > ${seed.before.updatedAt}::timestamptz
              ${unlinkPlan ? sql`and ${unlinkFinalStateSql(unlinkPlan, before)}` : sql``}
              ${request?.action === "exclude" ? sql`and e.exclusion_reason=${request.reason}` : sql``}
              ${original ? sql`and exists(select 1 from activity_events original
                where original.id=${original.receipt.operation.operationId}::uuid
                  and original.metadata #> '{extra,ebookReview,after}'=${JSON.stringify(seed.before)}::jsonb
                  and original.metadata #> '{extra,ebookReview,operation}'=${JSON.stringify(seed.originalOperation)}::jsonb)` : sql``}
          )) IS TRUE`, REVIEW_SQL_ERRORS.invalid));
      }),
      d.execute(assertSql(sql`((select count(*) from activity_events a
        where a.id=any(${uuidArraySql(ids)}))=${entries.length}) IS TRUE`, REVIEW_SQL_ERRORS.invalid)),
      // DECLARED terminal result position. No writer query may follow this suffix.
      d.execute(sql`select ${receiptRowSql()},${REVIEW_RESULT_MARKER}::text as "__reviewResult"
        from activity_events a where a.id=any(${uuidArraySql(ids)}) order by a.id`),
    ],
  });
  return Object.freeze({
    extension,
    readCommitted: (atomicResults: readonly unknown[]): readonly EbookReceipt[] => {
      const rows = resultRows<ActivityReviewRow & { __reviewResult: string }>(atomicResults.at(-1));
      if (rows.length !== entries.length || rows.some((row) => row.__reviewResult !== REVIEW_RESULT_MARKER) ||
          !same(rows.map((row) => row.id).sort(), [...ids].sort()))
        throw new ReviewError("invalid_receipt", "The atomic writer did not return its authoritative receipt set.");
      return rows.map((row) => {
        const entry = entries.find(({ seed }) => seed.operation.operationId === row.id)!;
        const receipt = readReviewReceiptRecord(row);
        if (receipt.entityType !== "ebook") throw new ReviewError("invalid_receipt", "Wrong receipt namespace.");
        const { after: _after, ...seed } = receipt;
        if (!same(seed, entry.seed))
          throw new ReviewError("invalid_receipt", "Committed receipt differs from its guarded seed.");
        if (entry.request) verifyReviewRetry(row, entry.request);
        if (entry.original) verifyReviewUndoRetry(row, entry.original.row);
        return immutableMatchingWriterInput(receipt);
      });
    },
  });
}
/** Uses the actual core decision policy, never an invented original review
 * receipt or compensation capability. The core validates its frozen plan. */
export function prepareReviewUnlinkAtomicWrite(input: {
  plan: ReviewUnlinkPlan; request: UnlinkRequest; before: ReviewBeforeRead;
  seed: ReceiptSeed; frozenEnvelopeHash: string;
}): PreparedReviewAtomicWrite {
  const frozen = immutableMatchingWriterInput(input);
  reviewHashSchema.parse(frozen.frozenEnvelopeHash);
  const request = reviewDecisionRequestSchema.parse(frozen.request);
  if (request.action !== "unlink") throw new ReviewError("invalid_receipt", "Unlink requires its decision request.");
  const { plan, before } = frozen, policy = parseReviewUnlinkPolicy(plan.reviewUnlink);
  if (frozen.frozenEnvelopeHash !== reviewPayloadHash({ plan, before, request }))
    throw new ReviewError("invalid_receipt", "Unlink differs from its complete frozen preview.");
  const operation = reviewOperationSchema.parse({ version: plan.version, operationId: plan.operationId,
    runId: plan.runId, planSha256: plan.planSha256, targetDatabase: plan.targetDatabase });
  const binding: MatchAtomicBinding = { coreWriter: "undo_link", coreOperation: operation,
    ebookIds: [request.ebookId], reviewOperations: [request.operation], purpose: "decision", reviewUnlink: policy };
  const seed = validateSeed(frozen.seed, before, binding);
  const keptCopy = plan.cleanup.retained.some((row) => row.table === "instances" && row.id === plan.receipt.instanceId);
  if (plan.kind !== "undo_link" || plan.reviewCompensation !== undefined || plan.classification.skipped !== null ||
      plan.classification.ebookId !== request.ebookId || before.ebookId !== request.ebookId || policy.ebookId !== request.ebookId ||
      !same(policy.expectedCurrent, before.snapshot) || policy.rawEbookSnapshotText !== before.rawEbookSnapshotText ||
      !before.matchingLinkReceipt || !same(before.matchingLinkReceipt, plan.receipt) ||
      !same(JSON.parse(before.rawEbookSnapshotText).link_written, plan.receipt) ||
      !same(matchingOperationOf(plan.receipt), request.originalOperation) ||
      !same(policy.originalMatchingOperation, request.originalOperation) ||
      request.originalOperation.operationId === operation.operationId || !same(request.operation, operation) ||
      !same(request.stamp, { updatedAt: before.snapshot.updatedAt, matchFingerprint: before.snapshot.matchFingerprint }) ||
      seed.action !== "unlink" || seed.originalOperation !== null || seed.outcome.keptCopy !== keptCopy ||
      seed.requestHash !== reviewRequestHash(request) || seed.effectHash !== request.effectHash ||
      request.effectHash !== reviewUnlinkEffectHash(plan))
    throw new ReviewError("invalid_receipt", "Unlink receipt does not bind its actual decision plan.");
  return preparedWrite(binding, [{ seed, before, request, unlinkPlan: plan }]);
}
export function prepareReviewAtomicWrite(input: ReviewWriteInput): PreparedReviewAtomicWrite {
  const frozen = immutableMatchingWriterInput(input);
  reviewHashSchema.parse(frozen.frozenEnvelopeHash);
  if (frozen.binding.purpose !== "decision" || frozen.requests.length !== frozen.seeds.length ||
      frozen.beforeReads.length !== frozen.seeds.length)
    throw new ReviewError("invalid_receipt", "A decision requires its complete request set.");
  const entries = frozen.seeds.map((value, index): Entry => {
    const request = supportedDecision(frozen.requests[index]), before = frozen.beforeReads[index];
    const seed = validateSeed(value, before, frozen.binding);
    assertEligible(request.action, seed.before);
    if (seed.action !== request.action || !same(seed.operation, request.operation) ||
        seed.requestHash !== reviewRequestHash(request) || seed.effectHash !== request.effectHash ||
        request.ebookId !== seed.entityId ||
        !same(request.stamp, { updatedAt: seed.before.updatedAt, matchFingerprint: seed.before.matchFingerprint }) ||
        (request.action === "restore" && request.expectedState !== seed.before.matchState))
      throw new ReviewError("invalid_receipt", "Receipt does not bind its exact decision request.");
    return { seed, before, request };
  });
  return preparedWrite(frozen.binding, entries);
}
export async function prepareReviewCompensationOn(
  conn: Db, input: UndoRequest, runtimeTarget: string,
): Promise<CompensationPreparation> {
  const request = undoEbookDecisionSchema.parse(input);
  const original = await readReviewReceiptOn(conn, request.originalOperation.operationId);
  if (!original || original.receipt.entityId !== request.ebookId ||
      original.receipt.action === "undo" || !same(original.receipt.operation, request.originalOperation) ||
      original.receipt.operation.targetDatabase !== runtimeTarget)
    throw new ReviewError("operation_collision", "The original reviewed decision could not be verified.");
  const operation = reviewOperationSchema.parse({
    ...original.receipt.operation, operationId: reviewUndoOperationId(original.receipt.operation),
  });
  const replay = await readReviewReceiptOn(conn, operation.operationId);
  if (replay) verifiedUndo(replay, original);
  const policy: ReviewCompensation = {
    originalOperation: original.receipt.operation, compensationOperationId: operation.operationId,
    originalAfterUpdatedAt: original.receipt.after.updatedAt,
  };
  const before = replay ? null : await readReviewBeforeOn(conn, request.ebookId);
  return immutableMatchingWriterInput({ original, replay, before, policy, operation });
}
export function prepareReviewCompensationAtomicWrite(input: CompensationWriteInput): PreparedReviewAtomicWrite {
  const frozen = immutableMatchingWriterInput(input);
  reviewHashSchema.parse(frozen.frozenEnvelopeHash);
  const { original, before, binding } = frozen;
  validateVerifiedRecord(original);
  const seed = validateSeed(frozen.seed, before, binding);
  if (binding.purpose !== "compensation" || !binding.compensation ||
      !["accept", "link", "accession", "keep", "exclude"].includes(original.receipt.action) ||
      seed.action !== "undo" || !same(seed.originalOperation, original.receipt.operation) ||
      !same(before.snapshot, original.receipt.after) ||
      seed.operation.operationId !== reviewUndoOperationId(original.receipt.operation) ||
      seed.operation.runId !== original.receipt.operation.runId ||
      seed.operation.targetDatabase !== original.receipt.operation.targetDatabase ||
      seed.operation.planSha256 !== original.receipt.operation.planSha256 ||
      seed.requestHash !== reviewPayloadHash({ action: "undo", entityType: "ebook",
        entityId: original.receipt.entityId, originalOperation: original.receipt.operation }) ||
      !same(binding.compensation, { originalOperation: original.receipt.operation,
        compensationOperationId: seed.operation.operationId, originalAfterUpdatedAt: original.receipt.after.updatedAt }))
    throw new ReviewError("invalid_receipt", "Compensation does not bind the original decision.");
  return preparedWrite(binding, [{ seed, before, original }]);
}
async function guardedReplay(conn: Db, records: readonly VerifiedReviewRecord[], operationIds: readonly string[]): Promise<ActivityReviewRow[]> {
  const snapshots = immutableMatchingWriterInput(records);
  const results = await atomicOn(conn, (d) => [
    // Replay does not read the target; ledger lock alone avoids stale target guards.
    d.execute(lockSql(["activity_events"])),
    ...snapshots.map((record) => d.execute(assertSql(sql`(exists(select 1 from activity_events a
      where a.id=${record.receipt.operation.operationId}::uuid
        and ${reviewTimestampIsValidSql(sql`a.created_at`)}
        and ${activityRawSnapshotSql()}=${record.rawSnapshotText})) IS TRUE`, REVIEW_SQL_ERRORS.stale))),
    d.execute(sql`select ${receiptRowSql()} from activity_events a where a.id=any(${uuidArraySql(operationIds)}) order by a.id`),
  ]);
  const rows = resultRows<ActivityReviewRow>(results.at(-1));
  if (rows.length !== operationIds.length || !same(rows.map((row) => row.id).sort(), [...operationIds].sort()))
    throw new ReviewError("invalid_receipt", "Stored receipts disappeared during replay.");
  return rows;
}
export async function replayReviewDecisionOn(conn: Db, stored: VerifiedReviewRecord, input: ReviewDecisionRequest): Promise<EbookReceipt> {
  const parsed = reviewDecisionRequestSchema.parse(input);
  if (parsed.action === "mark_accessioned")
    throw new ReviewError("unsupported_action", "This replay requires an eBook decision.");
  const request = immutableMatchingWriterInput(parsed);
  const frozen = immutableMatchingWriterInput(stored);
  verifiedRetry(frozen, request);
  const [row] = await guardedReplay(conn, [frozen], [request.operation.operationId]);
  const receipt = verifyReviewRetry(row, request);
  if (receipt.entityType !== "ebook") throw new ReviewError("invalid_receipt", "Wrong replay namespace.");
  return receipt;
}
export async function replayReviewCompensationOn(conn: Db, stored: VerifiedReviewRecord, original: VerifiedReviewRecord): Promise<EbookReceipt> {
  const [frozen, parent] = immutableMatchingWriterInput([stored, original]);
  verifiedUndo(frozen, parent);
  const [row] = await guardedReplay(conn, [parent, frozen], [frozen.receipt.operation.operationId]);
  const receipt = verifyReviewUndoRetry(row, parent.row);
  if (receipt.entityType !== "ebook") throw new ReviewError("invalid_receipt", "Wrong compensation namespace.");
  return receipt;
}
/** A receipt-first selection replay guards all audit evidence in one read atomic.
 * It never reads current targets, reconstructs receipts or repeats a writer. */
export async function replayReviewDecisionSetOn(
  conn: Db, records: readonly VerifiedReviewRecord[], inputs: readonly ReviewDecisionRequest[],
): Promise<readonly EbookReceipt[]> {
  const requests = immutableMatchingWriterInput(inputs.map(supportedDecision));
  const frozen = immutableMatchingWriterInput(records);
  if (!requests.length || requests.length > 50 || frozen.length !== requests.length ||
      new Set(requests.map((request) => request.operation.operationId)).size !== requests.length)
    throw new ReviewError("operation_collision", "The replay selection is incomplete or duplicated.");
  const aligned = requests.map((request) => {
    const record = frozen.find((row) => row.receipt.operation.operationId === request.operation.operationId);
    if (!record) throw new ReviewError("operation_collision", "The replay selection changed.");
    verifiedRetry(record, request);
    return record;
  });
  const rows = await guardedReplay(conn, aligned, requests.map((request) => request.operation.operationId));
  return requests.map((request) => {
    const receipt = verifyReviewRetry(rows.find((row) => row.id === request.operation.operationId), request);
    if (receipt.entityType !== "ebook") throw new ReviewError("invalid_receipt", "Wrong replay namespace.");
    return immutableMatchingWriterInput(receipt);
  });
}
