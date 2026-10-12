import type { prepareWorkReview } from "@/lib/actions/ebook-review";
import type { WorkReviewOutcome } from "@/lib/ebooks/review/work-service";
import { workId, stamp, operation } from "./review-ui-fixtures";
export const workStamp = { updatedAt: stamp.updatedAt, catalogueStatus: "wanted" as const,
  historyFingerprint: "a".repeat(64), dependencyFingerprint: "b".repeat(64), latestHistoryId: null };
export function preparedWork(): Awaited<ReturnType<typeof prepareWorkReview>> {
  return { request: { action: "mark_accessioned", workId, stamp: workStamp, operation, effectHash: "c".repeat(64) },
    previewToken: "d".repeat(64), preview: { text: "Marks the book as accessioned and records its status history.", fromStatus: "wanted", toStatus: "accessioned" },
    capabilities: { canApply: true, canUndo: true } };
}
export function workOutcome(): WorkReviewOutcome {
  return { workId, operation, message: "Book accessioned; status history recorded.", catalogueStatus: "accessioned",
    undo: { available: true, originalOperation: operation } };
}
