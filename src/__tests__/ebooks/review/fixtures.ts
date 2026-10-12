import type { Db } from "@/lib/catalogue/work-store";
import type { ReviewOperation } from "@/lib/validations/ebook-review";
import type { ReceiptSeed, ReviewBeforeRead, ReviewWriteInput } from "@/lib/ebooks/review/store";
import { REVIEW_RECEIPT_EVENTS, reviewPayloadHash, reviewRequestHash } from "@/lib/ebooks/review/receipts";

export const ebookId = "00000000-0000-4000-8000-000000000001";
export const operation: ReviewOperation = {
  version: 1, operationId: "00000000-0000-4000-8000-000000000002",
  runId: "00000000-0000-4000-8000-000000000003", planSha256: "a".repeat(64), targetDatabase: "test",
};
export function decisionFixture(): ReviewWriteInput {
  const before: ReviewBeforeRead = {
    ebookId, rawEbookSnapshotText: '{"id":"'+ebookId+'"}',
    candidateSnapshotTexts: [], matchingLinkReceipt: null,
    snapshot: { matchState: "pending", matchTier: null, matchFingerprint: null,
      updatedAt: "2026-10-10T10:00:00.123456Z", instanceId: null,
      exclusionReason: null, candidatesHash: reviewPayloadHash([]) },
  };
  const request = { action: "keep" as const, ebookId, operation: { ...operation },
    stamp: { updatedAt: before.snapshot.updatedAt, matchFingerprint: null }, effectHash: "b".repeat(64) };
  const seed: ReceiptSeed = {
    version: 1, operation: { ...operation }, requestHash: reviewRequestHash(request),
    effectHash: request.effectHash, entityType: "ebook", entityId: ebookId,
    eventKey: REVIEW_RECEIPT_EVENTS.ebookDecision, action: "keep", originalOperation: null,
    before: before.snapshot, outcome: { message: "Kept.", keptCopy: false },
  };
  return { binding: { coreWriter: "decision", coreOperation: { ...operation },
    ebookIds: [ebookId], reviewOperations: [{ ...operation }], purpose: "decision" },
    requests: [request], beforeReads: [before], seeds: [seed], frozenEnvelopeHash: "c".repeat(64) };
}
export const noDb = {} as Db;
