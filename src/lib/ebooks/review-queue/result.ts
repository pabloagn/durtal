import { ZodError } from "zod/v4";
import { ReviewError, ReviewPreparationError, type ReviewErrorCode } from "@/lib/ebooks/review/errors";
import { publicPreparationIssues } from "./preparation-issues";
import type { ReviewStamp, ReviewUiResult } from "./types";

const messages: Record<ReviewErrorCode, string> = {
  ebook_not_found: "This eBook is no longer available.",
  work_not_found: "This book is no longer available.",
  preparation_required: "Complete the highlighted choices before preparing this review.",
  preparation_unavailable: "The preview could not be prepared. Keep your choices and try again.",
  stale_review: "This eBook changed. Reload its proposals before preparing another decision.",
  operation_collision: "This operation no longer matches the stored decision. Reload before continuing.",
  preview_expired: "This preview expired. Prepare and check a new preview.",
  preview_too_large: "This preview is too large to keep. Prepare it for fewer eBooks.",
  ineligible_state: "This decision is no longer available for this eBook.",
  unsupported_action: "This decision is not available yet.",
  unsupported_undo: "This decision cannot be undone here.",
  outcome_unknown_retry_original: "The outcome could not be confirmed. Retry this same decision to check it.",
  invalid_receipt: "The decision could not be verified. Reload before continuing.",
};
export const reviewUiErrorMessage = (code: ReviewErrorCode) => messages[code];
export class ReviewSelectionConflict extends ReviewError {
  constructor(readonly ebookIds: string[]) { super("stale_review", messages.stale_review); }
}
/** Catch before Next serializes errors; arbitrary SQL and planner messages never reach a browser. */
export async function reviewUiResult<T>(work: () => Promise<T>, phase: "prepare" | "write" = "prepare"): Promise<ReviewUiResult<T>> {
  try { return { ok: true, value: await work() }; }
  catch (error) {
    if (error instanceof ReviewError) return { ok: false, error: {
      code: error.code, message: messages[error.code],
      retryOriginal: error.code === "outcome_unknown_retry_original",
      ...(error instanceof ReviewSelectionConflict ? { ebookIds: [...error.ebookIds] } : {}),
      ...(error instanceof ReviewPreparationError ? { issues: publicPreparationIssues(error.issues) } : {}),
    } };
    if (error instanceof ZodError) return { ok: false, error: {
      code: "invalid_input", message: "Check the selected book, author, language and ISBN.", retryOriginal: false,
    } };
    if (phase === "write") return { ok: false, error: {
      code: "outcome_unknown_retry_original", message: messages.outcome_unknown_retry_original, retryOriginal: true,
    } };
    return { ok: false, error: { code: "unavailable",
      message: "The preview could not be prepared. Keep your choices and try again.", retryOriginal: false } };
  }
}
export function requireReviewStamp(actual: ReviewStamp, expected: ReviewStamp): void {
  if (actual.updatedAt !== expected.updatedAt || actual.matchFingerprint !== expected.matchFingerprint)
    throw new ReviewError("stale_review", "The rendered review changed.");
}
