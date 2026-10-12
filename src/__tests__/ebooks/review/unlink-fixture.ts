import type { LinkReceipt } from "@/lib/ebooks/match/link";
import type { ReviewUnlinkPlan } from "@/lib/ebooks/review/unlink-contract";
import type { ReceiptSeed, ReviewBeforeRead, UnlinkRequest } from "@/lib/ebooks/review/store";
import { reviewUnlinkEffectHash } from "@/lib/ebooks/review/store";
import { parseReviewUnlinkPolicy } from "@/lib/ebooks/review/unlink-contract";
import { reviewPayloadHash, reviewRequestHash, REVIEW_RECEIPT_EVENTS } from "@/lib/ebooks/review/receipts";
import { ebookId, operation } from "./fixtures";

/** Construction fixture only: no actual core planner/writer or DB is invoked.
 * The real core refuses this synthetic plan; service tests replace that module. */
export function unlinkFixture(targetDatabase = "test") {
  const native = { ...operation, targetDatabase };
  const copyId = "00000000-0000-4000-8000-000000000004";
  const after = { id: ebookId, instance_id: copyId, match_state: "linked", match_tier: null,
    match_fingerprint: "b".repeat(64), exclusion_reason: null, match_method: "score", title: "Original title",
    created_at: "2026-10-10T10:00:00.123455Z", updated_at: "2026-10-10T10:00:00.123456Z", matched_at: null };
  const receipt = { ...native, kind: "link", ebookId, instanceId: copyId,
    after: { ebook: after, ownedChildren: {} } } as unknown as LinkReceipt;
  const before: ReviewBeforeRead = { ebookId, matchingLinkReceipt: receipt, candidateSnapshotTexts: [],
    rawEbookSnapshotText: JSON.stringify({ ...after, link_written: receipt }),
    snapshot: { matchState: "linked", matchTier: null, matchFingerprint: after.match_fingerprint,
      updatedAt: after.updated_at, instanceId: copyId, exclusionReason: null, candidatesHash: reviewPayloadHash([]) } };
  const policy = parseReviewUnlinkPolicy({ version: 1, purpose: "unlink_decision", mode: "automatic_undo", ebookId,
    originalMatchingOperation: native, expectedCurrent: before.snapshot,
    rawEbookSnapshotText: before.rawEbookSnapshotText, matchingAfterEbookText: JSON.stringify(after) });
  const actual = { ...native, operationId: "00000000-0000-4000-8000-000000000005", planSha256: "c".repeat(64) };
  const plan = { ...actual, kind: "undo_link", mode: "classification_only", receipt,
    createdAt: "2026-10-10T10:00:01.000Z", reviewUnlink: policy,
    cleanup: { retained: [{ table: "instances", id: copyId, reason: "Copy changed" }],
      deleted: { instances: [], editions: [], works: [], authors: [], series: [] },
      restoreCopy: null, activityIds: [], jobIds: [] },
    classification: { ebookId, fingerprint: "d".repeat(64), modelVersion: 1, tier: null,
      skipped: null, duplicateOfId: null, candidates: [], autoLink: false, flags: [], reasons: [] } } as unknown as ReviewUnlinkPlan;
  const request: UnlinkRequest = { action: "unlink", ebookId, operation: actual, originalOperation: native,
    stamp: { updatedAt: before.snapshot.updatedAt, matchFingerprint: before.snapshot.matchFingerprint }, effectHash: reviewUnlinkEffectHash(plan) };
  const seed: ReceiptSeed = { version: 1, operation: actual, requestHash: reviewRequestHash(request),
    effectHash: request.effectHash, entityType: "ebook", entityId: ebookId,
    eventKey: REVIEW_RECEIPT_EVENTS.ebookDecision, action: "unlink", originalOperation: null,
    before: before.snapshot, outcome: { message: "Returned to review. Kept the copy: Copy changed.", keptCopy: true } };
  return { plan, before, request, seed, frozenEnvelopeHash: reviewPayloadHash({ plan, before, request }) };
}
