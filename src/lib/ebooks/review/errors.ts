export type ReviewErrorCode =
  | "ebook_not_found" | "work_not_found" | "stale_review" | "operation_collision" | "preview_expired"
  | "ineligible_state" | "unsupported_action" | "unsupported_undo"
  | "preparation_required" | "preparation_unavailable"
  | "outcome_unknown_retry_original" | "invalid_receipt";
export class ReviewError extends Error {
  constructor(readonly code: ReviewErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReviewError";
  }
}
export type ReviewPreparationField = "authors" | "language" | "isbn13" | "locationId" |
  "file" | "title" | "workId" | "edition" | "copy" | "metadata" | "choices";
export interface ReviewPreparationIssue {
  ebookId: string; field: ReviewPreparationField; code: string; message: string;
}
/** Only static allowlisted labels enter these issues. Never ORM/SQL messages,
 * source paths, catalogue snapshots or generic effect.text. */
export class ReviewPreparationError extends ReviewError {
  readonly issues: readonly ReviewPreparationIssue[];
  constructor(issues: readonly ReviewPreparationIssue[], options?: ErrorOptions) {
    super("preparation_required", "Complete the highlighted choices before preparing this review.", options);
    this.issues = Object.freeze(issues.slice(0, 250).map((issue) => Object.freeze({ ...issue })));
  }
}
export const REVIEW_SQL_ERRORS = {
  stale: "EBOOK_REVIEW_STALE_V1",
  collision: "EBOOK_REVIEW_COLLISION_V1",
  invalid: "EBOOK_REVIEW_INVALID_RECEIPT_V1",
} as const;
/** Never expose arbitrary ORM/SQL messages as a domain error. */
export function reviewWriteError(error: unknown): ReviewError {
  if (error instanceof ReviewError) return error;
  // Drizzle and withReadableErrors wrap the actual assertion. Inspect only
  // bounded cause messages against our fixed vocabulary, never echo SQL.
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 6; depth++) {
    const record = current as { message?: unknown; cause?: unknown };
    const message = typeof record.message === "string" ? record.message : "";
    if (message === REVIEW_SQL_ERRORS.stale || message.startsWith("Matching snapshot changed in ") ||
        message.startsWith("Undo dependency changed in ") ||
        message === "Undo foreign references changed; make a new plan" ||
        message === "Original review receipt or exact after-state changed")
      return new ReviewError("stale_review", "This eBook changed. Prepare a new review.", { cause: error });
    if (message === REVIEW_SQL_ERRORS.collision)
      return new ReviewError("operation_collision", "This operation key is already in use.", { cause: error });
    if (message === REVIEW_SQL_ERRORS.invalid)
      return new ReviewError("invalid_receipt", "The review transaction failed validation.", { cause: error });
    current = record.cause;
  }
  return new ReviewError("outcome_unknown_retry_original",
    "The outcome could not be confirmed. Retry the original operation.", { cause: error });
}
