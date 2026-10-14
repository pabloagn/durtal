import { z } from "zod/v4";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { unlinkEbookSchema } from "@/lib/validations/ebook-review";
import { immutableMatchingWriterInput } from "../match/link";
import { reviewedUnlinkCore } from "../match/undo";
import { prepareReviewUnlinkIntentSchema, matchingOperationOf, parseReviewUnlinkPolicy,
  readMatchingUnlinkAfterOn, type ReviewUnlinkPlan } from "./unlink-contract";
import { readReviewBeforeOn, readReviewReceiptOn, replayReviewDecisionOn,
  prepareReviewUnlinkAtomicWrite, reviewUnlinkEffectHash,
  type ReceiptSeed, type UnlinkRequest, type VerifiedReviewRecord } from "./store";
import { canonicalReviewJson, reviewRequestHash, REVIEW_RECEIPT_EVENTS } from "./receipts";
import { previewRowsLoader, reviewPreviewCache } from "./preview";
import { freezeReviewContext, projectReviewOperation, reviewMessage, reviewOutcome,
  refreshReviewCaches, type ReviewContext, type ReviewOutcome } from "./service";
import { ReviewError, reviewWriteError } from "./errors";

const requestSchema = unlinkEbookSchema.extend({ action: z.literal("unlink") });
export const confirmedReviewUnlinkSchema = z.strictObject({
  request: requestSchema, previewToken: z.string().regex(/^[0-9a-f]{64}$/),
});
const same = (a: unknown, b: unknown) => canonicalReviewJson(a) === canonicalReviewJson(b);
function display(plan: ReviewUnlinkPlan) {
  const keptCopy = plan.cleanup.retained.some((row) => row.table === "instances" && row.id === plan.receipt.instanceId);
  const reasons = plan.cleanup.retained.filter((row) => row.table === "instances" && row.id === plan.receipt.instanceId)
    .map((row) => row.reason).join("; ");
  return { keptCopy, text: reviewMessage(keptCopy ? `Returned to review. Kept the copy: ${reasons}.` : "Returned to review.") };
}
/** Both automatic Undo and a fresh unlink inspect the real native receipt on
 * the supplied protected RR connection, then call the actual policy overload.
 * Automatic Undo refuses every later ebook edit; unlink binds the current row. */
export async function prepareEbookUnlinkReview(input: unknown, ctx: ReviewContext) {
  const context = freezeReviewContext(ctx), intent = prepareReviewUnlinkIntentSchema.parse(input);
  const envelope = await withReadOnlyPlanningConnection(context.planningUrl, async (conn) => {
    const before = await readReviewBeforeOn(conn, intent.ebookId);
    if (!before) throw new ReviewError("ebook_not_found", "eBook not found.");
    const receipt = before.matchingLinkReceipt;
    if (!receipt || !receipt.after) throw new ReviewError("invalid_receipt", "The committed matching receipt is missing.");
    const originalMatchingOperation = matchingOperationOf(receipt);
    if (originalMatchingOperation.targetDatabase !== context.targetDatabase ||
        (intent.originalMatchingOperation && !same(intent.originalMatchingOperation, originalMatchingOperation)))
      throw new ReviewError("operation_collision", "The matching link identity changed.");
    const matchingAfterEbookText = await readMatchingUnlinkAfterOn(conn, intent.ebookId);
    const policy = parseReviewUnlinkPolicy({ version: 1, purpose: "unlink_decision", mode: intent.mode,
      ebookId: intent.ebookId, originalMatchingOperation, expectedCurrent: before.snapshot,
      rawEbookSnapshotText: before.rawEbookSnapshotText, matchingAfterEbookText });
    const planned = await reviewedUnlinkCore.planOn(conn, receipt, context.targetDatabase, undefined, { reviewUnlink: policy });
    if (planned.kind !== "planned") throw new ReviewError("stale_review", "This matching link changed. Prepare a new review.");
    const plan = planned.plan;
    const request: UnlinkRequest = requestSchema.parse({ action: "unlink", ebookId: intent.ebookId,
      originalOperation: originalMatchingOperation, operation: projectReviewOperation(plan),
      stamp: { updatedAt: before.snapshot.updatedAt, matchFingerprint: before.snapshot.matchFingerprint },
      effectHash: reviewUnlinkEffectHash(plan) });
    return immutableMatchingWriterInput({ plan, before, request });
  }, { isolationLevel: "repeatable read" });
  const previewToken = reviewPreviewCache.issueUnlink(envelope, context.channel, context.targetDatabase);
  const shown = display(envelope.plan);
  return { request: envelope.request, previewToken,
    preview: { text: shown.text.replace(/^Returned to review\./, "Returns the eBook to review."), keptCopy: shown.keptCopy, mode: intent.mode,
      retained: envelope.plan.cleanup.retained, deleted: envelope.plan.cleanup.deleted,
      restoredCopy: envelope.plan.cleanup.restoreCopy },
    capabilities: { canApply: true, canUndo: false } };
}
async function lookup(context: ReviewContext, request: UnlinkRequest) {
  return withReadOnlyPlanningConnection(context.planningUrl,
    (conn) => readReviewReceiptOn(conn, request.operation.operationId), { isolationLevel: "repeatable read" });
}
export async function applyEbookUnlinkReview(input: unknown, ctx: ReviewContext): Promise<ReviewOutcome> {
  const context = freezeReviewContext(ctx), transport = confirmedReviewUnlinkSchema.parse(input);
  const request = immutableMatchingWriterInput(transport.request);
  if (request.operation.targetDatabase !== context.targetDatabase || request.originalOperation.targetDatabase !== context.targetDatabase)
    throw new ReviewError("operation_collision", "The operation belongs to another database.");
  // Durable replay precedes the cache and current target. Cache expiry, metadata
  // changes and target deletion cannot turn a committed retry into another write.
  const stored = await lookup(context, request);
  if (stored) {
    const receipt = await replayReviewDecisionOn(context.writeDb, stored, request);
    refreshReviewCaches(); return reviewOutcome(receipt);
  }
  const cached = await reviewPreviewCache.requireUnlink(transport.previewToken, request, context.channel, context.targetDatabase,
    previewRowsLoader(context.planningUrl));
  const { plan, before } = cached.envelope, shown = display(plan);
  const seed: ReceiptSeed = { version: 1, operation: request.operation,
    requestHash: reviewRequestHash(request), effectHash: request.effectHash,
    entityType: "ebook", entityId: request.ebookId, eventKey: REVIEW_RECEIPT_EVENTS.ebookDecision,
    action: "unlink", originalOperation: null, before: before.snapshot,
    outcome: { message: shown.text, keptCopy: shown.keptCopy } };
  const prepared = prepareReviewUnlinkAtomicWrite({ plan, before, request, seed, frozenEnvelopeHash: cached.hash });
  let results: readonly unknown[];
  try {
    results = await reviewedUnlinkCore.write(context.writeDb, plan, context.targetDatabase, { atomicExtension: prepared.extension });
  } catch (error) {
    let winner: VerifiedReviewRecord | null;
    try { winner = await lookup(context, request); }
    catch (cause) {
      throw new ReviewError("outcome_unknown_retry_original", "The outcome could not be confirmed. Retry the original operation.", { cause });
    }
    if (winner) {
      const receipt = await replayReviewDecisionOn(context.writeDb, winner, request);
      refreshReviewCaches(); return reviewOutcome(receipt);
    }
    throw reviewWriteError(error);
  }
  const [receipt] = prepared.readCommitted(results);
  refreshReviewCaches(); return reviewOutcome(receipt);
}
