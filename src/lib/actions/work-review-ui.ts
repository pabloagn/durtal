"use server";

import { z } from "zod/v4";
import { prepareWorkReview, confirmWorkReview, undoWorkReview } from "./ebook-review";
import { prepareWorkReviewSchema, confirmedWorkReviewSchema, undoWorkAccessionedSchema } from "@/lib/validations/ebook-review";
import { ReviewError } from "@/lib/ebooks/review/errors";
import { reviewUiResult } from "@/lib/ebooks/review-queue/result";

const input = z.strictObject({ intent: prepareWorkReviewSchema,
  expectedStatus: z.enum(["tracked", "shortlisted", "wanted", "on_order"]) });
export async function prepareWorkReviewUi(raw: unknown) {
  return reviewUiResult(async () => {
    const parsed = input.parse(raw), prepared = await prepareWorkReview(parsed.intent);
    if (prepared.request.stamp.catalogueStatus !== parsed.expectedStatus)
      throw new ReviewError("stale_review", "The shown status changed.");
    return prepared;
  });
}
export async function confirmWorkReviewUi(raw: unknown) {
  return reviewUiResult(async () => confirmWorkReview(confirmedWorkReviewSchema.parse(raw)), "write");
}
export async function undoWorkReviewUi(raw: unknown) {
  return reviewUiResult(async () => undoWorkReview(undoWorkAccessionedSchema.parse(raw)), "write");
}
