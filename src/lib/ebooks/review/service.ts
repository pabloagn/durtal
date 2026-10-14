import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/catalogue/work-store";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import {
  confirmedEbookReviewSchema, prepareEbookReviewSchema, reviewOperationSchema,
  undoEbookDecisionSchema, type PrepareEbookReview, type ReviewOperation,
} from "@/lib/validations/ebook-review";
import { databaseFingerprint } from "../ingest/command";
import { planLinkOn, linkEbook, immutableMatchingWriterInput } from "../match/link";
import { planAccessionOn, accessionEbooks } from "../match/accession";
import { planDecisionOn, applyDecision } from "../match/decisions";
import { planMatchingOn } from "../match/plan";
import { persistClassification } from "../match/classification";
import { planUndoLinkOn, undoLink } from "../match/undo";
import { MATCH_MODEL } from "../match/model";
import type { MatchOperationIdentity } from "../match/types";
import type { MatchAtomicBinding } from "../match/review-extension";
import {
  assertEligible, readReviewBeforeOn, readReviewReceiptOn, prepareReviewAtomicWrite,
  prepareReviewCompensationOn, prepareReviewCompensationAtomicWrite,
  replayReviewDecisionOn, replayReviewCompensationOn, supportedDecision,
  type EbookReceipt, type ReceiptSeed, type ReviewBeforeRead, type SupportedDecision, type VerifiedReviewRecord,
} from "./store";
import { reviewPayloadHash, reviewRequestHash, canonicalReviewJson, REVIEW_RECEIPT_EVENTS } from "./receipts";
import { previewRowsLoader, reviewPreviewCache, type ReviewPlan } from "./preview";
import { selectedCandidateHash } from "./candidate-hash";
import { ReviewError, reviewWriteError } from "./errors";
import { readPreparationRefusalOn } from "./preparation-errors";

export interface ReviewContext {
  readonly channel: "ui" | "api";
  readonly planningUrl: string;
  readonly writeDb: Db;
  readonly targetDatabase: string;
}
export function createReviewContext(channel: "ui" | "api"): ReviewContext {
  const planningUrl = serverEnv().DATABASE_URL;
  return { channel, planningUrl, writeDb: db, targetDatabase: databaseFingerprint(planningUrl) };
}
function frozenContext(input: ReviewContext): ReviewContext {
  if (input.targetDatabase !== databaseFingerprint(input.planningUrl))
    throw new ReviewError("operation_collision", "The runtime database identity changed.");
  return Object.freeze({ ...input });
}
function operationOf(input: MatchOperationIdentity): ReviewOperation {
  return reviewOperationSchema.parse({
    version: input.version, operationId: input.operationId, runId: input.runId,
    planSha256: input.planSha256, targetDatabase: input.targetDatabase,
  });
}
const shortMessage = (message: string) => Array.from(message).slice(0, 900).join("");
export interface ReviewOutcome {
  ebookId: string; operation: ReviewOperation; message: string; keptCopy: boolean;
  undo: { available: boolean; originalOperation: ReviewOperation | null };
}
function outcome(receipt: EbookReceipt): ReviewOutcome {
  const available = ["accept", "link", "accession", "keep", "exclude"].includes(receipt.action);
  return { ebookId: receipt.entityId, operation: receipt.operation,
    message: receipt.outcome.message, keptCopy: receipt.outcome.keptCopy,
    undo: { available, originalOperation: available ? receipt.operation : null } };
}
function refresh() {
  // This existing helper is deliberately best-effort; durable success is not
  // converted to failure by cache invalidation. Read availability remains authoritative.
  invalidate(CACHE_TAGS.works, CACHE_TAGS.editions, CACHE_TAGS.activity, CACHE_TAGS.authors, CACHE_TAGS.series);
}
/** Internal server composition helpers shared by the bounded selection service. */
export { frozenContext as freezeReviewContext, operationOf as projectReviewOperation,
  shortMessage as reviewMessage, outcome as reviewOutcome, refresh as refreshReviewCaches };
async function beforeOn(conn: Db, ebookId: string): Promise<ReviewBeforeRead> {
  const before = await readReviewBeforeOn(conn, ebookId);
  if (!before) throw new ReviewError("ebook_not_found", "eBook not found.");
  return before;
}
function effectOf(plan: ReviewPlan): unknown {
  switch (plan.kind) {
    case "link": return { effect: plan.effect, choices: plan.choices };
    case "accession_batch": return plan.entries.map((entry) => entry.effect);
    case "decision": return plan.decision;
    case "classification": return { results: plan.results, restoreIds: plan.restoreIds };
  }
}
function planMessage(plan: ReviewPlan): string {
  switch (plan.kind) {
    case "link": return plan.effect.text;
    case "accession_batch": return plan.entries[0].effect.text;
    case "decision": return plan.decision.action === "keep" ? "Kept as a standalone eBook." : "Set aside.";
    case "classification": return plan.restoreIds.length ? "Returned to review." : "Updated review proposals.";
  }
}
function coreWriter(plan: ReviewPlan): MatchAtomicBinding["coreWriter"] {
  return plan.kind === "accession_batch" ? "accession" : plan.kind;
}
function same(a: unknown, b: unknown) {
  return canonicalReviewJson(a) === canonicalReviewJson(b);
}
function acceptCandidate(plan: Extract<ReviewPlan, { kind: "link" }>, before: ReviewBeforeRead, intent: Extract<PrepareEbookReview, { action: "accept" }>) {
  const candidate = plan.snapshot.rows.ebook_match_candidates.find((row) =>
    row.ebook_id === intent.ebookId && row.rank === intent.rank);
  const text = before.candidateSnapshotTexts.find((value) => JSON.parse(value).rank === intent.rank);
  if (!candidate || !text || candidate.model_version !== MATCH_MODEL.version ||
      candidate.edition_rule !== plan.effect.rule ||
      (candidate.edition_id ?? null) !== plan.effect.editionId ||
      (candidate.instance_id ?? null) !== (plan.effect.movedFromEditionId ? null : plan.effect.instanceId) ||
      intent.candidateHash !== selectedCandidateHash(text, intent.rank,
        before.snapshot.matchFingerprint, Number(candidate.model_version), plan.effect))
    throw new ReviewError("stale_review", "This proposal changed. Prepare a new review.");
}
async function prepareOn(conn: Db, intent: PrepareEbookReview, context: ReviewContext) {
  const before = await beforeOn(conn, intent.ebookId);
  assertEligible(intent.action, before.snapshot);
  if (intent.action === "restore" && before.snapshot.matchState !== intent.expectedState)
    throw new ReviewError("stale_review", "The stored decision changed.");
  // A genuine server-issued manual planning run, exactly as the core wrappers
  // allocate. This is never an ingest run/currentness proof or client identity.
  const identity = { runId: randomUUID(), targetDatabase: context.targetDatabase };
  let plan: ReviewPlan;
  switch (intent.action) {
    case "accept": {
      const [row] = before.candidateSnapshotTexts.map((text) => JSON.parse(text) as { rank: number; work_id: string })
        .filter((candidate) => candidate.rank === intent.rank);
      if (!row) throw new ReviewError("stale_review", "The selected proposal is missing.");
      plan = await planLinkOn(conn, { ebookId: intent.ebookId, workId: row.work_id, method: "manual" }, identity);
      acceptCandidate(plan, before, intent);
      break;
    }
    case "link": {
      const choice = intent.choice;
      plan = await planLinkOn(conn, {
        ebookId: intent.ebookId, workId: intent.workId, method: "manual",
        ...(choice.kind === "new_edition" ? {
          newEdition: { ...(choice.language !== undefined ? { language: choice.language } : {}),
            ...(choice.isbn13 !== undefined ? { isbn13: choice.isbn13 } : {}) },
        } : { editionId: choice.editionId, ...(choice.kind === "fill_copy" ? { instanceId: choice.instanceId } : {}) }),
        ...(intent.locationId !== undefined ? { locationId: intent.locationId } : {}),
        ...(intent.newCopyDraft !== undefined ? { newCopyDraft: intent.newCopyDraft } : {}),
        ...(intent.existingCopyPatch !== undefined ? { existingCopyPatch: intent.existingCopyPatch,
          expectedCopyStamp: intent.expectedCopyStamp } : {}),
      }, identity);
      // Both choices are part of the native plan hash and of the prepared
      // request/cache/permanent receipt hash. Never apply a separate copy edit.
      if (intent.existingCopyPatch !== undefined &&
          (!same(plan.choices.existingCopyPatch, intent.existingCopyPatch) ||
           !same(plan.choices.expectedCopyStamp, intent.expectedCopyStamp)))
        throw new ReviewError("operation_collision", "The planned copy metadata differs from your edit.");
      if (choice.kind === "add_copy" && (!plan.effect.newCopy || plan.effect.instanceId) ||
          choice.kind === "new_edition" && !plan.effect.newEdition)
        throw new ReviewError("ineligible_state", "The planned effect differs from the requested copy choice.");
      if (choice.kind === "fill_copy" && intent.locationId !== undefined &&
          plan.snapshot.rows.instances.find((row) => row.id === choice.instanceId)?.location_id !== intent.locationId)
        throw new ReviewError("ineligible_state", "Linking cannot move this copy to another location.");
      break;
    }
    case "accession":
      plan = await planAccessionOn(conn, [intent.ebookId], identity, new Map([[intent.ebookId, {
        ...(intent.authors !== undefined ? { authors: intent.authors } : {}),
        ...(intent.language !== undefined ? { language: intent.language } : {}),
        ...(intent.isbn13 !== undefined ? { isbn13: intent.isbn13 } : {}),
      }]]));
      break;
    case "keep": case "exclude":
      plan = await planDecisionOn(conn, [intent.ebookId], intent.action === "keep"
        ? { action: "keep" } : { action: "set_aside", reason: intent.reason }, identity);
      break;
    case "restore": case "rematch":
      plan = await planMatchingOn(conn, [intent.ebookId], {
        ...identity, mode: "classification_only",
        ...(intent.action === "restore" ? { restoreIds: [intent.ebookId] } : { rematch: true }),
      });
      break;
  }
  const operation = plan.kind === "accession_batch" ? operationOf(plan.entries[0].receipt) : operationOf(plan);
  const request = supportedDecision({
    ...intent, operation,
    stamp: { updatedAt: before.snapshot.updatedAt, matchFingerprint: before.snapshot.matchFingerprint },
    effectHash: reviewPayloadHash(effectOf(plan)),
  });
  return immutableMatchingWriterInput({ plan, request, before });
}
export async function prepareEbookReview(input: unknown, ctx: ReviewContext) {
  const context = frozenContext(ctx), intent = immutableMatchingWriterInput(prepareEbookReviewSchema.parse(input));
  const envelope = await withReadOnlyPlanningConnection(context.planningUrl,
    async (conn) => {
      try { return await prepareOn(conn, intent, context); }
      catch (cause) {
        if (cause instanceof ReviewError) throw cause;
        let refusal;
        try { refusal = await readPreparationRefusalOn(conn, [intent]); }
        catch { throw new ReviewError("preparation_unavailable", "The review preview could not be prepared. Keep your choices and try again.", { cause }); }
        if (refusal) throw refusal;
        throw new ReviewError("preparation_unavailable", "The review preview could not be prepared. Keep your choices and try again.", { cause });
      }
    }, { isolationLevel: "repeatable read" });
  const previewToken = reviewPreviewCache.issue(envelope, context.channel, context.targetDatabase);
  const plan = envelope.plan;
  const digital = plan.kind === "link" ? (plan.effect.newCopy ?? plan.effect.filledCopy) :
    plan.kind === "accession_batch" ? plan.entries[0].effect.copy : null;
  return {
    request: envelope.request, previewToken,
    preview: { text: shortMessage(planMessage(plan)),
      format: digital?.format ?? null, fileSizeBytes: digital?.fileSizeBytes ?? null,
      locationId: plan.kind === "link" ? plan.effect.newCopy?.locationId ??
        (plan.effect.instanceId ? String(plan.snapshot.rows.instances.find((row) => row.id === plan.effect.instanceId)?.location_id) : null) :
        plan.kind === "accession_batch" ? plan.entries[0].effect.copy?.locationId ?? null : null },
    capabilities: { canApply: true, canUndo: ["accept", "link", "accession", "keep", "exclude"].includes(intent.action) },
  };
}
async function lookupDecision(context: ReviewContext, request: SupportedDecision) {
  return withReadOnlyPlanningConnection(context.planningUrl,
    (conn) => readReviewReceiptOn(conn, request.operation.operationId), { isolationLevel: "repeatable read" });
}
export async function applyEbookReview(input: unknown, previewToken: string, ctx: ReviewContext): Promise<ReviewOutcome> {
  const context = frozenContext(ctx);
  const transport = confirmedEbookReviewSchema.parse({ request: input, previewToken });
  const request = immutableMatchingWriterInput(supportedDecision(transport.request));
  if (request.operation.targetDatabase !== context.targetDatabase)
    throw new ReviewError("operation_collision", "The operation belongs to another database.");
  const stored = await lookupDecision(context, request);
  if (stored) {
    const receipt = await replayReviewDecisionOn(context.writeDb, stored, request);
    refresh(); return outcome(receipt);
  }
  const cached = await reviewPreviewCache.require(transport.previewToken, request, context.channel, context.targetDatabase,
    previewRowsLoader(context.planningUrl));
  const { plan, before } = cached.envelope;
  const seed: ReceiptSeed = {
    version: 1, operation: request.operation, requestHash: reviewRequestHash(request),
    effectHash: request.effectHash, entityType: "ebook", entityId: request.ebookId,
    eventKey: REVIEW_RECEIPT_EVENTS.ebookDecision, action: request.action, originalOperation: null,
    before: before.snapshot, outcome: { message: shortMessage(planMessage(plan)), keptCopy: false },
  };
  const prepared = prepareReviewAtomicWrite({
    binding: { coreWriter: coreWriter(plan), coreOperation: operationOf(plan), ebookIds: [request.ebookId],
      reviewOperations: [request.operation], purpose: "decision" },
    requests: [request], beforeReads: [before], seeds: [seed], frozenEnvelopeHash: cached.hash,
  });
  let results: unknown[];
  try {
    switch (plan.kind) {
      case "link": results = await linkEbook(context.writeDb, plan, context.targetDatabase, { atomicExtension: prepared.extension }); break;
      case "accession_batch": results = (await accessionEbooks(context.writeDb, plan, context.targetDatabase, { atomicExtension: prepared.extension })).result; break;
      case "decision": results = await applyDecision(context.writeDb, plan, context.targetDatabase, { atomicExtension: prepared.extension }); break;
      case "classification": results = await persistClassification(context.writeDb, plan, context.targetDatabase, { atomicExtension: prepared.extension }); break;
    }
  } catch (error) {
    let winner: VerifiedReviewRecord | null;
    try { winner = await lookupDecision(context, request); }
    catch (cause) {
      throw new ReviewError("outcome_unknown_retry_original",
        "The outcome could not be confirmed. Retry the original operation.", { cause });
    }
    if (winner) {
      const receipt = await replayReviewDecisionOn(context.writeDb, winner, request);
      refresh(); return outcome(receipt);
    }
    throw reviewWriteError(error);
  }
  const [receipt] = prepared.readCommitted(results);
  refresh(); return outcome(receipt);
}
export async function undoEbookReview(input: unknown, ctx: ReviewContext): Promise<ReviewOutcome> {
  const context = frozenContext(ctx), request = immutableMatchingWriterInput(undoEbookDecisionSchema.parse(input));
  if (request.originalOperation.targetDatabase !== context.targetDatabase)
    throw new ReviewError("operation_collision", "The original operation belongs to another database.");
  const preparation = await withReadOnlyPlanningConnection(context.planningUrl, async (conn) => {
    const prepared = await prepareReviewCompensationOn(conn, request, context.targetDatabase);
    const original = prepared.original.receipt;
    if (!["accept", "link", "accession", "keep", "exclude"].includes(original.action))
      throw new ReviewError("unsupported_undo", "This review action has no supported inverse.");
    if (prepared.replay) return { prepared, plan: null };
    if (!prepared.before || !same(prepared.before.snapshot, original.after))
      throw new ReviewError("stale_review", "A later change prevents this Undo.");
    if (original.action === "keep" || original.action === "exclude") {
      const plan = await planMatchingOn(conn, [request.ebookId], {
        mode: "classification_only", restoreIds: [request.ebookId], targetDatabase: context.targetDatabase,
        runId: original.operation.runId, reviewCompensation: prepared.policy,
      });
      return { prepared, plan };
    }
    const matching = prepared.before.matchingLinkReceipt;
    if (!matching || !same(operationOf(matching), original.operation))
      throw new ReviewError("stale_review", "The original matching receipt changed.");
    const planned = await planUndoLinkOn(conn, matching, context.targetDatabase, undefined,
      { reviewCompensation: prepared.policy });
    if (planned.kind !== "planned")
      throw new ReviewError("stale_review", "The linked operation changed.");
    return { prepared, plan: planned.plan };
  }, { isolationLevel: "repeatable read" });
  const { prepared: base, plan } = preparation;
  if (base.replay) {
    const receipt = await replayReviewCompensationOn(context.writeDb, base.replay, base.original);
    refresh(); return outcome(receipt);
  }
  if (!plan || !base.before) throw new ReviewError("stale_review", "Undo could not be prepared.");
  const keptCopy = plan.kind === "undo_link" && plan.cleanup.retained.some((row) => row.table === "instances");
  const reason = plan.kind === "undo_link" ? plan.cleanup.retained.filter((row) => row.table === "instances").map((row) => row.reason).join("; ") : "";
  const seed: ReceiptSeed = {
    version: 1, operation: base.operation,
    requestHash: reviewPayloadHash({ action: "undo", entityType: "ebook", entityId: request.ebookId,
      originalOperation: base.original.receipt.operation }),
    effectHash: reviewPayloadHash(plan.kind === "undo_link" ? plan.cleanup : plan.results),
    entityType: "ebook", entityId: request.ebookId, eventKey: REVIEW_RECEIPT_EVENTS.ebookUndo,
    action: "undo", originalOperation: base.original.receipt.operation, before: base.before.snapshot,
    outcome: { message: shortMessage(keptCopy ? `Returned to review. Kept the copy: ${reason}.` : "Returned to review."), keptCopy },
  };
  const prepared = prepareReviewCompensationAtomicWrite({
    binding: { coreWriter: plan.kind === "undo_link" ? "undo_link" : "classification", coreOperation: operationOf(plan),
      ebookIds: [request.ebookId], reviewOperations: [base.operation], purpose: "compensation", compensation: base.policy },
    original: base.original, before: base.before, seed, frozenEnvelopeHash: reviewPayloadHash(plan),
  });
  let results: unknown[];
  try {
    results = plan.kind === "undo_link"
      ? await undoLink(context.writeDb, plan, context.targetDatabase, { atomicExtension: prepared.extension })
      : await persistClassification(context.writeDb, plan, context.targetDatabase, { atomicExtension: prepared.extension });
  } catch (error) {
    let winner: VerifiedReviewRecord | null;
    try {
      winner = await withReadOnlyPlanningConnection(context.planningUrl,
        (conn) => readReviewReceiptOn(conn, base.operation.operationId), { isolationLevel: "repeatable read" });
    } catch (cause) {
      throw new ReviewError("outcome_unknown_retry_original",
        "The outcome could not be confirmed. Retry the original operation.", { cause });
    }
    if (winner) {
      const receipt = await replayReviewCompensationOn(context.writeDb, winner, base.original);
      refresh(); return outcome(receipt);
    }
    throw reviewWriteError(error);
  }
  const [receipt] = prepared.readCommitted(results);
  refresh(); return outcome(receipt);
}
