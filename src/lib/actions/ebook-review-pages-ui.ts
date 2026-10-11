"use server";
import { reviewSelectionPageSchema } from "@/lib/ebooks/review-queue/params";
import { getReviewSelectionPage } from "@/lib/ebooks/review-queue/queries";
import { reviewUiResult } from "@/lib/ebooks/review-queue/result";
export async function readReviewSelectionPageUi(raw: unknown) {
  return reviewUiResult(async () => getReviewSelectionPage(reviewSelectionPageSchema.parse(raw)));
}
