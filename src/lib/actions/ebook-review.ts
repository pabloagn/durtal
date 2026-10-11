"use server";

import { createReviewContext, prepareEbookReview, applyEbookReview, undoEbookReview } from "@/lib/ebooks/review/service";
import { getEbookReview } from "@/lib/ebooks/review/queries";
import { prepareEbookReviewSelection, applyEbookReviewSelection, undoEbookReviewSelection } from "@/lib/ebooks/review/bulk";
import { prepareWorkStatusReview, applyWorkStatusReview, undoWorkStatusReview } from "@/lib/ebooks/review/work-service";
import { prepareEbookUnlinkReview, applyEbookUnlinkReview } from "@/lib/ebooks/review/unlink-service";
/** Same service as REST; Next's existing server-action origin enforcement applies. */
export async function prepareReview(input: unknown) {
  return prepareEbookReview(input, createReviewContext("ui"));
}
export async function confirmReview(input: unknown, previewToken: string) {
  return applyEbookReview(input, previewToken, createReviewContext("ui"));
}
export async function undoReview(input: unknown) {
  return undoEbookReview(input, createReviewContext("ui"));
}
export async function readReview(ebookId: string) {
  return getEbookReview(createReviewContext("ui").planningUrl, ebookId);
}
export async function prepareReviewSelection(input: unknown) {
  return prepareEbookReviewSelection(input, createReviewContext("ui"));
}
export async function confirmReviewSelection(input: unknown) {
  return applyEbookReviewSelection(input, createReviewContext("ui"));
}
export async function undoReviewSelection(input: unknown) {
  return undoEbookReviewSelection(input, createReviewContext("ui"));
}
export async function prepareWorkReview(input: unknown) {
  return prepareWorkStatusReview(input, createReviewContext("ui"));
}
export async function confirmWorkReview(input: unknown) {
  return applyWorkStatusReview(input, createReviewContext("ui"));
}
export async function undoWorkReview(input: unknown) {
  return undoWorkStatusReview(input, createReviewContext("ui"));
}
export async function prepareReviewUnlink(input: unknown) {
  return prepareEbookUnlinkReview(input, createReviewContext("ui"));
}
export async function confirmReviewUnlink(input: unknown) {
  return applyEbookUnlinkReview(input, createReviewContext("ui"));
}
