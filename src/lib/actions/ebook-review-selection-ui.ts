"use server";

import { z } from "zod/v4";
import { prepareReviewSelection, confirmReviewSelection, undoReviewSelection, readReview } from "./ebook-review";
import { ebookReviewStampSchema, prepareReviewSelectionSchema, confirmedReviewSelectionSchema,
  undoReviewSelectionSchema } from "@/lib/validations/ebook-review";
import { getReviewStamps } from "@/lib/ebooks/review-queue/queries";
import { ReviewSelectionConflict, reviewUiResult, reviewUiErrorMessage } from "@/lib/ebooks/review-queue/result";

const guard = z.strictObject({ ebookId: z.uuid(), stamp: ebookReviewStampSchema });
const prepareInput = z.strictObject({ intents: prepareReviewSelectionSchema.shape.intents,
  stamps: z.array(guard).min(1).max(50) }).superRefine(({ intents, stamps }, context) => {
  if (new Set(stamps.map((row) => row.ebookId)).size !== stamps.length ||
      stamps.length !== intents.length || intents.some((intent) => !stamps.some((row) => row.ebookId === intent.ebookId)))
    context.addIssue({ code: "custom", message: "Each selected eBook has exactly one rendered guard" });
});
export async function prepareReviewSelectionUi(raw: unknown) {
  return reviewUiResult(async () => {
    const input = prepareInput.parse(raw);
    // Also retain the shared intent selection's distinct identity validation.
    const intent = prepareReviewSelectionSchema.parse({ intents: input.intents });
    const actual = await getReviewStamps(input.stamps.map((row) => row.ebookId));
    const changed = input.stamps.filter(({ ebookId, stamp }) => {
      const stored = actual.get(ebookId);
      return !stored || stored.updatedAt !== stamp.updatedAt || stored.matchFingerprint !== stamp.matchFingerprint;
    });
    if (changed.length) throw new ReviewSelectionConflict(changed.map((row) => row.ebookId));
    const prepared = await prepareReviewSelection(intent);
    const mismatches = prepared.requests.filter((request) => {
      const expected = input.stamps.find((row) => row.ebookId === request.ebookId)!.stamp;
      return request.stamp.updatedAt !== expected.updatedAt || request.stamp.matchFingerprint !== expected.matchFingerprint;
    });
    if (mismatches.length) throw new ReviewSelectionConflict(mismatches.map((row) => row.ebookId));
    return prepared;
  });
}
/** A fresh candidate proof is loaded only for the ordinary single-target commit
 * prefix. Remaining selected row descriptors get their own later visible preview. */
export async function prepareAcceptReviewSelectionUi(raw: unknown) {
  return reviewUiResult(async () => {
    const input = guard.extend({ workId: z.uuid(), rank: z.number().int().min(1).max(3) }).parse(raw);
    const detail = await readReview(input.ebookId);
    if (detail.stamp.updatedAt !== input.stamp.updatedAt || detail.stamp.matchFingerprint !== input.stamp.matchFingerprint)
      throw new ReviewSelectionConflict([input.ebookId]);
    const candidate = detail.candidates.find((row) => row.rank === input.rank && row.workId === input.workId && row.eligible);
    if (!candidate) throw new ReviewSelectionConflict([input.ebookId]);
    const prepared = await prepareReviewSelection({ intents: [{ action: "accept", ebookId: input.ebookId,
      rank: candidate.rank, candidateHash: candidate.candidateHash }] });
    if (prepared.requests[0].stamp.updatedAt !== input.stamp.updatedAt || prepared.requests[0].stamp.matchFingerprint !== input.stamp.matchFingerprint)
      throw new ReviewSelectionConflict([input.ebookId]);
    return prepared;
  });
}
export async function confirmReviewSelectionUi(raw: unknown) {
  return reviewUiResult(async () => confirmReviewSelection(confirmedReviewSelectionSchema.parse(raw)), "write");
}
export async function undoReviewSelectionUi(raw: unknown) {
  return reviewUiResult(async () => {
    const result = await undoReviewSelection(undoReviewSelectionSchema.parse(raw));
    return { ...result, rows: result.rows.map((row) => row.status === "committed" ? row :
      { ...row, message: reviewUiErrorMessage(row.code) }) };
  }, "write");
}
