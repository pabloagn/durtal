import type { Db } from "@/lib/catalogue/work-store";
import { immutableMatchingWriterInput, type LinkReceipt } from "../match/link";
import { planUndoLinkOn, type UndoLinkPlan } from "../match/undo";
import { canonicalReviewJson } from "./receipts";
import { readReviewBeforeOn, type ReviewBeforeRead } from "./store";
import { matchingOperationOf, parseReviewUnlinkPolicy, prepareReviewUnlinkIntentSchema,
  readMatchingUnlinkAfterOn, type ReviewUnlinkPolicy } from "./unlink-contract";
import { ReviewError } from "./errors";

export interface ReviewUnlinkInspection {
  before: ReviewBeforeRead; receipt: LinkReceipt; policy: ReviewUnlinkPolicy;
  /** Actual core cleanup/reference analysis, never an executable review plan. */
  inspectionPlan: UndoLinkPlan;
  preview: { text: string; keptCopy: boolean; retained: readonly { table: string; id: string; reason: string }[] };
}
/** Protected RR caller only. Inspect real cleanup relationships so changed or
 * referenced copies/books are retained by the existing core ownership policy.
 * All covers/files remain outside this service: no source bytes are deleted.
 * Kept separate from the codec so495 can use it without importing its own
 * undo planner or496 store through the codec. No writer/extension is called. */
export async function inspectReviewUnlinkOn(conn: Db, input: unknown, target: string): Promise<ReviewUnlinkInspection> {
  const intent = immutableMatchingWriterInput(prepareReviewUnlinkIntentSchema.parse(input));
  const before = await readReviewBeforeOn(conn, intent.ebookId);
  if (!before) throw new ReviewError("ebook_not_found", "eBook not found.");
  const receipt = before.matchingLinkReceipt;
  if (!receipt || !receipt.after) throw new ReviewError("invalid_receipt", "The committed matching receipt is missing.");
  const originalMatchingOperation = matchingOperationOf(receipt);
  if (originalMatchingOperation.targetDatabase !== target ||
      (intent.originalMatchingOperation && canonicalReviewJson(intent.originalMatchingOperation) !== canonicalReviewJson(originalMatchingOperation)))
    throw new ReviewError("operation_collision", "The matching link identity changed.");
  const matchingAfterEbookText = await readMatchingUnlinkAfterOn(conn, intent.ebookId);
  const policy = parseReviewUnlinkPolicy({ version: 1, purpose: "unlink_decision", mode: intent.mode,
    ebookId: intent.ebookId, originalMatchingOperation, expectedCurrent: before.snapshot,
    rawEbookSnapshotText: before.rawEbookSnapshotText, matchingAfterEbookText });
  const inspected = await planUndoLinkOn(conn, receipt, target);
  if (inspected.kind !== "planned") throw new ReviewError("stale_review", "This matching link changed. Prepare a new review.");
  const keptCopy = inspected.plan.cleanup.retained.some((row) => row.table === "instances" && row.id === receipt.instanceId);
  return immutableMatchingWriterInput({ before, receipt, policy, inspectionPlan: inspected.plan,
    preview: { text: "Unlinks the eBook, returns it to review and applies the displayed catalogue cleanup.",
      keptCopy, retained: inspected.plan.cleanup.retained } });
}
