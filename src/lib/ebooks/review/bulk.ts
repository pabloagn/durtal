import { randomUUID } from "node:crypto";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { prepareReviewSelectionSchema, confirmedReviewSelectionSchema, undoReviewSelectionSchema,
  type PrepareEbookReview, type ReviewOperation } from "@/lib/validations/ebook-review";
import { planAccessionOn, accessionEbooks, type AccessionPlan } from "../match/accession";
import { immutableMatchingWriterInput } from "../match/link";
import { assertEligible, readReviewBeforeOn, readReviewReceiptOn, replayReviewDecisionSetOn,
  prepareReviewAtomicWrite, supportedDecision, type ReceiptSeed, type VerifiedReviewRecord,
  type SupportedDecision, type EbookReceipt, type ReviewBeforeRead } from "./store";
import { prepareEbookReview, applyEbookReview, undoEbookReview, freezeReviewContext,
  projectReviewOperation, reviewMessage, reviewOutcome, refreshReviewCaches,
  type ReviewContext, type ReviewOutcome } from "./service";
import { reviewPreviewCache } from "./preview";
import { reviewPayloadHash, reviewRequestHash, REVIEW_RECEIPT_EVENTS } from "./receipts";
import { ReviewError, reviewWriteError, type ReviewErrorCode } from "./errors";
import { readPreparationRefusalOn } from "./preparation-errors";

type AccessionIntent = Extract<PrepareEbookReview, { action: "accession" }>;
type AccessionRequest = Extract<SupportedDecision, { action: "accession" }>;
export interface PreparedReviewSelection {
  requests: readonly SupportedDecision[];
  previewToken: string;
  rows: readonly { ebookId: string; text: string; format: string | null;
    fileSizeBytes: number | null; locationId: string | null; canUndo: boolean }[];
  /** Only these rows share the confirmed commit unit. Never the entire selection. */
  preparedCount: number;
  selectionCount: number;
  deferredIntents: readonly PrepareEbookReview[];
  /** Counts from the actual accession plan; absent for other single actions. */
  accessionCounts?: { books: number; editions: number; copies: number; newAuthors: number; newSeries: number };
}
export interface ReviewSelectionOutcome { outcomes: readonly ReviewOutcome[] }

/** Ordered selection <=50. Only consecutive accessions can share the actual
 * core multi-ebook atomic. Every other core review extension has a one-target
 * scope. Deferred intent is exposed explicitly, never planned again on apply. */
export async function prepareEbookReviewSelection(input: unknown, ctx: ReviewContext): Promise<PreparedReviewSelection> {
  const context = freezeReviewContext(ctx);
  const { intents } = immutableMatchingWriterInput(prepareReviewSelectionSchema.parse(input));
  let count = 1;
  if (intents[0].action === "accession")
    while (count < intents.length && intents[count].action === "accession") count++;
  if (count === 1) {
    const prepared = await prepareEbookReview(intents[0], context);
    return { requests: [prepared.request], previewToken: prepared.previewToken,
      rows: [{ ebookId: prepared.request.ebookId, ...prepared.preview, canUndo: prepared.capabilities.canUndo }],
      preparedCount: 1, selectionCount: intents.length, deferredIntents: intents.slice(1) };
  }
  const prefix = intents.slice(0, count) as AccessionIntent[];
  const envelope = await withReadOnlyPlanningConnection(context.planningUrl, async (conn) => {
    const beforeReads: ReviewBeforeRead[] = [];
    for (const intent of prefix) {
      const before = await readReviewBeforeOn(conn, intent.ebookId);
      if (!before) throw new ReviewError("ebook_not_found", "A selected eBook was not found.");
      assertEligible("accession", before.snapshot); beforeReads.push(before);
    }
    const choices = new Map(prefix.map((intent) => [intent.ebookId, {
      ...(intent.authors !== undefined ? { authors: intent.authors } : {}),
      ...(intent.language !== undefined ? { language: intent.language } : {}),
      ...(intent.isbn13 !== undefined ? { isbn13: intent.isbn13 } : {}),
    }]));
    let plan: AccessionPlan;
    try { plan = await planAccessionOn(conn, prefix.map((intent) => intent.ebookId),
      { runId: randomUUID(), targetDatabase: context.targetDatabase }, choices); }
    catch (cause) {
      if (cause instanceof ReviewError) throw cause;
      let refusal;
      try { refusal = await readPreparationRefusalOn(conn, prefix); }
      catch { throw new ReviewError("preparation_unavailable", "The selection preview could not be prepared. Keep your choices and try again.", { cause }); }
      if (refusal) throw refusal;
      throw new ReviewError("preparation_unavailable", "The selection preview could not be prepared. Keep your choices and try again.", { cause });
    }
    const effectHash = reviewPayloadHash(plan.entries.map((entry) => entry.effect));
    const requests = prefix.map((intent): AccessionRequest => {
      const entry = plan.entries.find((row) => row.effect.ebookId === intent.ebookId);
      const before = beforeReads.find((row) => row.ebookId === intent.ebookId)!;
      if (!entry) throw new ReviewError("invalid_receipt", "The planned accession scope changed.");
      const parsed = supportedDecision({ ...intent, operation: projectReviewOperation(entry.receipt), effectHash,
        stamp: { updatedAt: before.snapshot.updatedAt, matchFingerprint: before.snapshot.matchFingerprint } });
      if (parsed.action !== "accession") throw new ReviewError("invalid_receipt", "Unexpected accession action.");
      return parsed;
    });
    return immutableMatchingWriterInput({ plan, requests, beforeReads });
  }, { isolationLevel: "repeatable read" });
  const previewToken = reviewPreviewCache.issueAccession(envelope, context.channel, context.targetDatabase);
  return { requests: envelope.requests, previewToken, rows: envelope.requests.map((request) => {
    const effect = envelope.plan.entries.find((entry) => entry.effect.ebookId === request.ebookId)!.effect;
    return { ebookId: request.ebookId, text: reviewMessage(effect.text), format: effect.copy?.format ?? null,
      fileSizeBytes: effect.copy?.fileSizeBytes ?? null, locationId: effect.copy?.locationId ?? null, canUndo: true };
  }), preparedCount: count, selectionCount: intents.length, deferredIntents: intents.slice(count),
    accessionCounts: { books: envelope.plan.entries.length, editions: envelope.plan.entries.length,
      copies: envelope.plan.entries.length, newAuthors: envelope.plan.authors.length, newSeries: envelope.plan.series.length } };
}

async function lookup(context: ReviewContext, requests: readonly SupportedDecision[]) {
  return withReadOnlyPlanningConnection(context.planningUrl, async (conn) => {
    const records = [];
    for (const request of requests) records.push(await readReviewReceiptOn(conn, request.operation.operationId));
    return records;
  }, { isolationLevel: "repeatable read" });
}
async function replay(context: ReviewContext, records: readonly (VerifiedReviewRecord | null)[], requests: readonly SupportedDecision[]) {
  if (records.every((record) => record === null)) return null;
  if (records.some((record) => record === null))
    throw new ReviewError("operation_collision", "Only part of this confirmed operation set exists. Retry the original selection.");
  const receipts = await replayReviewDecisionSetOn(context.writeDb, records as VerifiedReviewRecord[], requests);
  refreshReviewCaches(); return { outcomes: receipts.map(reviewOutcome) };
}

/** Confirm exactly the visible prepared prefix. No deferred-row writes, fresh
 * plans, regenerated identities or second accession after an ambiguous result. */
export async function applyEbookReviewSelection(input: unknown, ctx: ReviewContext): Promise<ReviewSelectionOutcome> {
  const context = freezeReviewContext(ctx), transport = immutableMatchingWriterInput(confirmedReviewSelectionSchema.parse(input));
  const requests = transport.requests.map(supportedDecision);
  if (requests.some((request) => request.operation.targetDatabase !== context.targetDatabase))
    throw new ReviewError("operation_collision", "The selection belongs to another database.");
  if (requests.length === 1)
    return { outcomes: [await applyEbookReview(requests[0], transport.previewToken, context)] };
  if (requests.some((request) => request.action !== "accession") ||
      requests.some((request) => request.operation.planSha256 !== requests[0].operation.planSha256))
    throw new ReviewError("unsupported_action", "Prepare one core commit unit before confirming this selection.");
  const previous = await replay(context, await lookup(context, requests), requests);
  if (previous) return previous;
  const cached = reviewPreviewCache.requireAccession(transport.previewToken, requests, context.channel, context.targetDatabase);
  const { plan, beforeReads } = cached.envelope;
  const seeds: ReceiptSeed[] = requests.map((request) => ({
    version: 1, operation: request.operation, requestHash: reviewRequestHash(request), effectHash: request.effectHash,
    entityType: "ebook", entityId: request.ebookId, eventKey: REVIEW_RECEIPT_EVENTS.ebookDecision,
    action: "accession", originalOperation: null,
    before: beforeReads.find((before) => before.ebookId === request.ebookId)!.snapshot,
    outcome: { message: reviewMessage(plan.entries.find((entry) => entry.effect.ebookId === request.ebookId)!.effect.text), keptCopy: false },
  }));
  const prepared = prepareReviewAtomicWrite({
    binding: { coreWriter: "accession", coreOperation: projectReviewOperation(plan),
      ebookIds: requests.map((request) => request.ebookId), reviewOperations: requests.map((request) => request.operation), purpose: "decision" },
    requests, seeds, beforeReads, frozenEnvelopeHash: cached.hash,
  });
  let receipts: readonly EbookReceipt[];
  try {
    const result = await accessionEbooks(context.writeDb, plan, context.targetDatabase, { atomicExtension: prepared.extension });
    receipts = prepared.readCommitted(result.result);
  }
  catch (error) {
    let records;
    try { records = await lookup(context, requests); }
    catch (cause) {
      throw new ReviewError("outcome_unknown_retry_original", "The outcome could not be confirmed. Retry the original selection.", { cause });
    }
    const winner = await replay(context, records, requests);
    if (winner) return winner;
    throw reviewWriteError(error);
  }
  refreshReviewCaches();
  return { outcomes: requests.map((request) => reviewOutcome(receipts.find((receipt) => receipt.operation.operationId === request.operation.operationId)!)) };
}

export type ReviewUndoSelectionRow = { status: "committed"; outcome: ReviewOutcome } |
  { status: "refused" | "unconfirmed"; ebookId: string; originalOperation: ReviewOperation; code: ReviewErrorCode; message: string };
/** Explicit bulk Undo has per-operation atomicity. Stop at the first refusal or
 * uncertain result and preserve every earlier durable outcome. Retrying original
 * identities replays prior compensations before attempting the remainder. */
export async function undoEbookReviewSelection(input: unknown, ctx: ReviewContext) {
  const context = freezeReviewContext(ctx), { requests } = immutableMatchingWriterInput(undoReviewSelectionSchema.parse(input));
  if (requests.some((request) => request.originalOperation.targetDatabase !== context.targetDatabase))
    throw new ReviewError("operation_collision", "The selection belongs to another database.");
  const rows: ReviewUndoSelectionRow[] = [];
  for (const [index, request] of requests.entries()) {
    try { rows.push({ status: "committed", outcome: await undoEbookReview(request, context) }); }
    catch (cause) {
      const error = reviewWriteError(cause);
      rows.push({ status: ["outcome_unknown_retry_original", "invalid_receipt"].includes(error.code) ? "unconfirmed" : "refused",
        ebookId: request.ebookId, originalOperation: request.originalOperation, code: error.code, message: error.message });
      return { rows, deferredRequests: requests.slice(index + 1), stopped: true };
    }
  }
  return { rows, deferredRequests: [], stopped: false };
}
