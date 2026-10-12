import type { PreparedUnlinkReview, ReviewUnlinkTarget, ReviewUnlinkMode } from "@/lib/ebooks/review-queue/unlink-types";
import type { ReviewOutcome } from "@/lib/ebooks/review-queue/types";
import { ebookId, stamp, operation } from "./review-ui-fixtures";
export const unlinkOperation = { ...operation, operationId: "77777777-7777-4777-8777-777777777777",
  runId: "66666666-6666-4666-8666-666666666666", planSha256: "f".repeat(64) };
export const unlinkTarget: ReviewUnlinkTarget = { id: ebookId, title: "Nadja", stamp,
  matching: { operation, automatic: true } };
export function preparedUnlink(mode: ReviewUnlinkMode = "automatic_undo"): PreparedUnlinkReview {
  return { request: { action: "unlink", ebookId, stamp, operation: unlinkOperation, originalOperation: operation, effectHash: "c".repeat(64) },
    previewToken: "d".repeat(64), preview: { text: "Returns the eBook to review. Kept the copy: referenced.",
      mode, keptCopy: true, restoredCopy: false, deleted: { copies: 0, editions: 0, books: 0, authors: 0, series: 0 } },
    capabilities: { canApply: true, canUndo: false } };
}
export function unlinkOutcome(): ReviewOutcome {
  return { ebookId, operation: unlinkOperation, message: "Returned to review. Kept the copy: referenced.",
    keptCopy: true, undo: { available: false, originalOperation: null } };
}
