import { randomUUID } from "node:crypto";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { confirmedWorkReviewSchema, prepareWorkReviewSchema, reviewOperationSchema, undoWorkAccessionedSchema,
  type ReviewOperation } from "@/lib/validations/ebook-review";
import { immutableMatchingWriterInput } from "../match/link";
import { freezeReviewContext, refreshReviewCaches, type ReviewContext } from "./service";
import { reviewPreviewCache } from "./preview";
import { canonicalReviewJson, reviewPayloadHash, reviewRequestHash, reviewUndoOperationId, REVIEW_RECEIPT_EVENTS } from "./receipts";
import { assertWorkStatusEligible, readWorkReviewBeforeOn, readWorkReviewReceiptOn, replayWorkReviewOn,
  writeWorkReviewOn, verifyWorkRetry, verifyWorkUndoRetry, type WorkReceipt, type WorkSeed,
  type WorkRequest, type VerifiedWorkRecord } from "./work-store";
import { ReviewError, reviewWriteError } from "./errors";

export interface WorkReviewOutcome {
  workId: string; operation: ReviewOperation; message: string;
  catalogueStatus: WorkReceipt["after"]["catalogueStatus"];
  undo: { available: boolean; originalOperation: ReviewOperation | null };
}
function outcome(receipt: WorkReceipt): WorkReviewOutcome {
  const available = receipt.action === "mark_accessioned";
  return { workId: receipt.entityId, operation: receipt.operation, message: receipt.outcome.message,
    catalogueStatus: receipt.after.catalogueStatus,
    undo: { available, originalOperation: available ? receipt.operation : null } };
}
const same = (a: unknown, b: unknown) => canonicalReviewJson(a) === canonicalReviewJson(b);
async function lookup(context: ReviewContext, operationId: string) {
  return withReadOnlyPlanningConnection(context.planningUrl, (conn) => readWorkReviewReceiptOn(conn, operationId),
    { isolationLevel: "repeatable read" });
}
export async function prepareWorkStatusReview(input: unknown, ctx: ReviewContext) {
  const context = freezeReviewContext(ctx), intent = immutableMatchingWriterInput(prepareWorkReviewSchema.parse(input));
  const envelope = await withReadOnlyPlanningConnection(context.planningUrl, async (conn) => {
    const before = await readWorkReviewBeforeOn(conn, intent.workId);
    if (!before) throw new ReviewError("work_not_found", "Book not found.");
    assertWorkStatusEligible(before);
    const historyId = randomUUID(), effect = { workId: intent.workId, from: before.stamp.catalogueStatus, to: "accessioned" };
    const operation = reviewOperationSchema.parse({ version: 1, operationId: randomUUID(), runId: randomUUID(),
      targetDatabase: context.targetDatabase,
      planSha256: reviewPayloadHash({ kind: "work_status", before, effect, historyId, targetDatabase: context.targetDatabase }) });
    const request: WorkRequest = { ...intent, stamp: before.stamp, effectHash: reviewPayloadHash(effect), operation };
    const text = "Marks the book as accessioned and records its status history.";
    return immutableMatchingWriterInput({ request, before, historyId, text });
  }, { isolationLevel: "repeatable read" });
  return { request: envelope.request, previewToken: reviewPreviewCache.issueWork(envelope, context.channel, context.targetDatabase),
    preview: { text: envelope.text, fromStatus: envelope.before.stamp.catalogueStatus, toStatus: "accessioned" as const },
    capabilities: { canApply: true, canUndo: true } };
}
async function replay(context: ReviewContext, stored: VerifiedWorkRecord, binding: WorkRequest | VerifiedWorkRecord) {
  const receipt = await replayWorkReviewOn(context.writeDb, stored, binding);
  refreshReviewCaches(); return outcome(receipt);
}
/** A response-loss check has one read attempt under the original operation.
 * No second write, regenerated plan or synthetic success follows uncertainty. */
async function resolveFailure(context: ReviewContext, operationId: string,
  binding: WorkRequest | VerifiedWorkRecord, error: unknown) {
  let stored;
  try { stored = await lookup(context, operationId); }
  catch (cause) { throw new ReviewError("outcome_unknown_retry_original", "The outcome could not be confirmed. Retry the original work operation.", { cause }); }
  if (stored) return replay(context, stored, binding);
  throw reviewWriteError(error);
}
export async function applyWorkStatusReview(input: unknown, ctx: ReviewContext): Promise<WorkReviewOutcome> {
  const context = freezeReviewContext(ctx), { request, previewToken } = immutableMatchingWriterInput(confirmedWorkReviewSchema.parse(input));
  if (request.operation.targetDatabase !== context.targetDatabase)
    throw new ReviewError("operation_collision", "This book preview belongs to another database.");
  const stored = await lookup(context, request.operation.operationId);
  if (stored) { verifyWorkRetry(stored, request); return replay(context, stored, request); }
  const { envelope } = reviewPreviewCache.requireWork(previewToken, request, context.channel, context.targetDatabase);
  const seed: WorkSeed = { version: 1, operation: request.operation, requestHash: reviewRequestHash(request),
    effectHash: request.effectHash, entityType: "work", entityId: request.workId, eventKey: REVIEW_RECEIPT_EVENTS.workDecision,
    action: "mark_accessioned", originalOperation: null, before: envelope.before.stamp,
    outcome: { message: envelope.text, keptCopy: false } };
  let receipt: WorkReceipt;
  try { receipt = await writeWorkReviewOn(context.writeDb, { before: envelope.before, seed, historyId: envelope.historyId, request }); }
  catch (error) { return resolveFailure(context, request.operation.operationId, request, error); }
  refreshReviewCaches(); return outcome(receipt);
}
export async function undoWorkStatusReview(input: unknown, ctx: ReviewContext): Promise<WorkReviewOutcome> {
  const context = freezeReviewContext(ctx), request = immutableMatchingWriterInput(undoWorkAccessionedSchema.parse(input));
  if (request.originalOperation.targetDatabase !== context.targetDatabase)
    throw new ReviewError("operation_collision", "The original work operation belongs to another database.");
  const prepared = await withReadOnlyPlanningConnection(context.planningUrl, async (conn) => {
    const original = await readWorkReviewReceiptOn(conn, request.originalOperation.operationId);
    if (!original || original.receipt.entityId !== request.workId || original.receipt.action !== "mark_accessioned" ||
        !same(original.receipt.operation, request.originalOperation))
      throw new ReviewError("operation_collision", "The original work status decision could not be verified.");
    const operation = reviewOperationSchema.parse({ ...original.receipt.operation,
      operationId: reviewUndoOperationId(original.receipt.operation) });
    const stored = await readWorkReviewReceiptOn(conn, operation.operationId);
    if (stored) { verifyWorkUndoRetry(stored, original); return immutableMatchingWriterInput({ original, operation, stored, before: null }); }
    const before = await readWorkReviewBeforeOn(conn, request.workId);
    if (!before || !same(before.stamp, original.receipt.after) || before.rawWorkText !== original.rawWorkAfterText)
      throw new ReviewError("stale_review", "The book has a later status, history or dependency change.");
    return immutableMatchingWriterInput({ original, operation, stored: null, before });
  }, { isolationLevel: "repeatable read" });
  if (prepared.stored) return replay(context, prepared.stored, prepared.original);
  const seed: WorkSeed = { version: 1, operation: prepared.operation,
    requestHash: reviewPayloadHash({ action: "undo", entityType: "work", entityId: request.workId,
      originalOperation: prepared.original.receipt.operation }), effectHash: prepared.original.receipt.effectHash,
    entityType: "work", entityId: request.workId, eventKey: REVIEW_RECEIPT_EVENTS.workUndo,
    action: "undo", originalOperation: prepared.original.receipt.operation, before: prepared.before!.stamp,
    outcome: { message: "Restored the book’s previous catalogue status and recorded its history.", keptCopy: false } };
  let receipt: WorkReceipt;
  try { receipt = await writeWorkReviewOn(context.writeDb, { before: prepared.before!, seed,
    historyId: randomUUID(), original: prepared.original }); }
  catch (error) { return resolveFailure(context, prepared.operation.operationId, prepared.original, error); }
  refreshReviewCaches(); return outcome(receipt);
}
