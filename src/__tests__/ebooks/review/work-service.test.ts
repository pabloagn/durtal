import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/catalogue/work-store";
import { databaseFingerprint } from "@/lib/ebooks/ingest/command";
import { REVIEW_RECEIPT_EVENTS, reviewRequestHash } from "@/lib/ebooks/review/receipts";
import { ebookId } from "./fixtures";
const mocks = vi.hoisted(() => ({ before: vi.fn(), read: vi.fn(), write: vi.fn(), replay: vi.fn() }));
vi.mock("@/lib/enrichment/read-only-session", () => ({
  withReadOnlyPlanningConnection: async (_url: string, run: (db: object) => unknown) => run({}),
}));
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(), CACHE_TAGS: {
  works: "works", editions: "editions", activity: "activity", authors: "authors", series: "series" } }));
vi.mock("@/lib/ebooks/review/work-store", async (original) => ({
  ...await original<typeof import("@/lib/ebooks/review/work-store")>(), readWorkReviewBeforeOn: mocks.before,
  readWorkReviewReceiptOn: mocks.read, writeWorkReviewOn: mocks.write, replayWorkReviewOn: mocks.replay,
}));
import { prepareWorkStatusReview, applyWorkStatusReview, undoWorkStatusReview } from "@/lib/ebooks/review/work-service";
const url = "postgresql://fixture@localhost/sln496_ebook_review";
const context = { planningUrl: url, targetDatabase: databaseFingerprint(url), channel: "api" as const, writeDb: {} as Db };
const before = { workId: ebookId, rawWorkText: "full DB work row", historyTexts: [], activeLinkedCopy: true,
  stamp: { updatedAt: "2026-10-10T10:00:00.123456Z", catalogueStatus: "tracked", historyFingerprint: "a".repeat(64),
    dependencyFingerprint: "b".repeat(64), latestHistoryId: null } };
function stored(request: Awaited<ReturnType<typeof prepareWorkStatusReview>>["request"]) {
  const receipt = { version: 1 as const, operation: request.operation, requestHash: reviewRequestHash(request),
    effectHash: request.effectHash, entityType: "work" as const, entityId: ebookId, action: "mark_accessioned" as const,
    eventKey: REVIEW_RECEIPT_EVENTS.workDecision, originalOperation: null, before: request.stamp,
    after: { ...request.stamp, catalogueStatus: "accessioned" as const, updatedAt: "2026-10-10T10:00:00.123457Z",
      historyFingerprint: "c".repeat(64), latestHistoryId: "00000000-0000-4000-8000-000000000004" },
    outcome: { message: "Marks the book as accessioned.", keptCopy: false } };
  return { receipt, rawSnapshotText: "full DB audit row", rawWorkAfterText: "full DB after work row", row: { id: request.operation.operationId,
    entityType: "work" as const, entityId: ebookId, eventKey: receipt.eventKey,
    metadata: { extra: { ebookReview: receipt, workReviewAfterRaw: "full DB after work row" } } } };
}
describe("actual work-status service composition", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.before.mockResolvedValue(before); mocks.read.mockResolvedValue(null); });
  it("freezes one visible request and invokes its status/history writer once", async () => {
    const prepared = await prepareWorkStatusReview({ action: "mark_accessioned", workId: ebookId }, context);
    mocks.write.mockResolvedValue(stored(prepared.request).receipt);
    const result = await applyWorkStatusReview({ request: prepared.request, previewToken: prepared.previewToken }, context);
    expect(result.catalogueStatus).toBe("accessioned"); expect(result.undo.originalOperation).toEqual(prepared.request.operation);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.write.mock.calls[0][1].request).toEqual(prepared.request);
    expect(mocks.write.mock.calls[0][1].before).toEqual(before);
  });
  it("replays durable status before cache lookup and never issues another writer", async () => {
    const prepared = await prepareWorkStatusReview({ action: "mark_accessioned", workId: ebookId }, context), record = stored(prepared.request);
    mocks.read.mockResolvedValue(record); mocks.replay.mockResolvedValue(record.receipt);
    const result = await applyWorkStatusReview({ request: prepared.request, previewToken: "0".repeat(64) }, context);
    expect(result.operation).toEqual(record.receipt.operation); expect(mocks.write).not.toHaveBeenCalled();
  });
  it("resolves a lost acknowledgement under the same identity with one writer and one recovery lookup", async () => {
    const prepared = await prepareWorkStatusReview({ action: "mark_accessioned", workId: ebookId }, context), record = stored(prepared.request);
    mocks.read.mockResolvedValueOnce(null).mockResolvedValueOnce(record); mocks.write.mockRejectedValue(new Error("lost response"));
    mocks.replay.mockResolvedValue(record.receipt);
    expect((await applyWorkStatusReview({ request: prepared.request, previewToken: prepared.previewToken }, context)).operation).toEqual(prepared.request.operation);
    expect(mocks.write).toHaveBeenCalledTimes(1); expect(mocks.read).toHaveBeenCalledTimes(2);
  });
  it("refuses missing preview and later history/dependency versions without issuing a new writer", async () => {
    const prepared = await prepareWorkStatusReview({ action: "mark_accessioned", workId: ebookId }, context), record = stored(prepared.request);
    await expect(applyWorkStatusReview({ request: prepared.request, previewToken: "0".repeat(64) }, context)).rejects.toMatchObject({ code: "preview_expired" });
    mocks.read.mockResolvedValueOnce(record).mockResolvedValueOnce(null);
    mocks.before.mockResolvedValue({ ...before, stamp: { ...record.receipt.after, dependencyFingerprint: "f".repeat(64) } });
    await expect(undoWorkStatusReview({ workId: ebookId, originalOperation: prepared.request.operation }, context)).rejects.toMatchObject({ code: "stale_review" });
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
