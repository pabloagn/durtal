import {
  reviewPayloadHash,
  reviewRequestHash,
  reviewUndoOperationId,
  REVIEW_RECEIPT_EVENTS,
} from "@/lib/ebooks/review/receipts";

export const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const hash = "a".repeat(64);
export const at = "2026-10-09T20:00:00.000001Z";
export const later = "2026-10-09T20:00:00.000002Z";
export const operation = {
  version: 1 as const,
  operationId: id(1),
  runId: id(2),
  planSha256: hash,
  targetDatabase: "preview:sln496_ebook_review",
};
export const stamp = { matchFingerprint: hash, updatedAt: at };
export const workStamp = {
  updatedAt: at,
  catalogueStatus: "wanted" as const,
  latestHistoryId: id(10),
  historyFingerprint: hash,
  dependencyFingerprint: hash,
};
export function keepRequest() {
  return {
    action: "keep" as const,
    ebookId: id(3),
    stamp: { ...stamp },
    operation: { ...operation },
    effectHash: hash,
  };
}
export function keepReceipt() {
  const request = keepRequest();
  return {
    version: 1 as const,
    operation: { ...operation },
    requestHash: reviewRequestHash(request),
    effectHash: hash,
    entityType: "ebook" as const,
    entityId: request.ebookId,
    eventKey: REVIEW_RECEIPT_EVENTS.ebookDecision,
    action: "keep" as const,
    originalOperation: null,
    before: {
      matchState: "pending" as const,
      matchTier: "likely" as const,
      matchFingerprint: hash,
      updatedAt: at,
      instanceId: null,
      exclusionReason: null,
      candidatesHash: hash,
    },
    after: {
      matchState: "standalone" as const,
      matchTier: null,
      matchFingerprint: hash,
      updatedAt: later,
      instanceId: null,
      exclusionReason: null,
      candidatesHash: reviewPayloadHash([]),
    },
    outcome: { message: "Kept as eBook", keptCopy: false },
  };
}
export function undoReceipt() {
  const original = keepReceipt();
  return {
    ...original,
    action: "undo" as const,
    eventKey: REVIEW_RECEIPT_EVENTS.ebookUndo,
    operation: { ...operation, operationId: reviewUndoOperationId(operation) },
    originalOperation: operation,
    requestHash: reviewPayloadHash({
      action: "undo",
      entityType: original.entityType,
      entityId: original.entityId,
      originalOperation: operation,
    }),
    before: original.after,
    after: { ...original.before, updatedAt: "2026-10-09T20:00:00.000003Z" },
    outcome: { message: "Returned to review", keptCopy: false },
  };
}
