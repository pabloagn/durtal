"use server";

import { z } from "zod/v4";
import { prepareReview, confirmReview, undoReview, readReview } from "./ebook-review";
import { prepareEbookReviewSchema, ebookReviewStampSchema, confirmedEbookReviewSchema,
  undoEbookDecisionSchema } from "@/lib/validations/ebook-review";
import { reviewUiResult, requireReviewStamp } from "@/lib/ebooks/review-queue/result";
import { getReviewWorkOptions, searchReviewEbooks } from "@/lib/ebooks/review-queue/queries";

const readInput = z.strictObject({ ebookId: z.uuid(), stamp: ebookReviewStampSchema });
const prepareInput = z.strictObject({ intent: prepareEbookReviewSchema, stamp: ebookReviewStampSchema });
export async function readReviewUi(raw: unknown) {
  return reviewUiResult(async () => {
    const input = readInput.parse(raw);
    const detail = await readReview(input.ebookId);
    requireReviewStamp(detail.stamp, input.stamp);
    return detail;
  });
}
export async function prepareReviewUi(raw: unknown) {
  return reviewUiResult(async () => {
    const input = prepareInput.parse(raw);
    const prepared = await prepareReview(input.intent);
    // The service issues a fresh operation; it may only describe the row the user saw.
    requireReviewStamp(prepared.request.stamp, input.stamp);
    return prepared;
  });
}
export async function confirmReviewUi(raw: unknown) {
  return reviewUiResult(async () => {
    const input = confirmedEbookReviewSchema.parse(raw);
    return confirmReview(input.request, input.previewToken);
  }, "write");
}
export async function undoReviewUi(raw: unknown) {
  return reviewUiResult(async () => undoReview(undoEbookDecisionSchema.parse(raw)), "write");
}
export async function readReviewWorkOptions(raw: unknown) {
  return reviewUiResult(async () => {
    const input = z.strictObject({ workId: z.uuid(), ebookId: z.uuid() }).parse(raw);
    return getReviewWorkOptions(input.workId, input.ebookId);
  });
}
export async function searchReviewEbooksUi(raw: unknown) {
  return reviewUiResult(async () => searchReviewEbooks(z.string().trim().max(200).parse(raw)));
}
