import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/catalogue/work-store";
import { databaseFingerprint } from "@/lib/ebooks/ingest/command";
import { unlinkFixture } from "./unlink-fixture";
import { reviewPreviewCache } from "@/lib/ebooks/review/preview";
const mocks = vi.hoisted(() => ({ read: vi.fn(), before: vi.fn(), after: vi.fn(), replay: vi.fn(), prepare: vi.fn(),
  plan: vi.fn(), defaultPlan: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/enrichment/read-only-session", () => ({
  withReadOnlyPlanningConnection: async (_url: string, run: (conn: object) => unknown) => run({}),
}));
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(),
  CACHE_TAGS: { works: "works", editions: "editions", activity: "activity", authors: "authors", series: "series" } }));
vi.mock("@/lib/ebooks/match/undo", async (original) => ({
  ...await original<typeof import("@/lib/ebooks/match/undo")>(),
  planUndoLinkOn: mocks.defaultPlan,
  reviewedUnlinkCore: { planOn: mocks.plan, write: mocks.write },
}));
vi.mock("@/lib/ebooks/review/store", async (original) => ({
  ...await original<typeof import("@/lib/ebooks/review/store")>(),
  readReviewReceiptOn: mocks.read, readReviewBeforeOn: mocks.before,
  replayReviewDecisionOn: mocks.replay, prepareReviewUnlinkAtomicWrite: mocks.prepare,
}));
vi.mock("@/lib/ebooks/review/unlink-contract", async (original) => ({
  ...await original<typeof import("@/lib/ebooks/review/unlink-contract")>(), readMatchingUnlinkAfterOn: mocks.after,
}));
import { applyEbookUnlinkReview, prepareEbookUnlinkReview } from "@/lib/ebooks/review/unlink-service";
const url = "postgresql://fixture@localhost/sln496_ebook_review", target = databaseFingerprint(url);
const context = { channel: "api" as const, planningUrl: url, writeDb: {} as Db, targetDatabase: target };
describe("unlink service replay/write boundary (module mocks, no database)", () => {
  beforeEach(() => vi.resetAllMocks());
  it("prepares through the actual reviewed policy export and displays its exact cleanup without a default-plan cast", async () => {
    const input = unlinkFixture(target);
    mocks.before.mockResolvedValue(input.before); mocks.after.mockResolvedValue(input.plan.reviewUnlink.matchingAfterEbookText);
    mocks.plan.mockResolvedValue({ kind: "planned", plan: input.plan });
    const result = await prepareEbookUnlinkReview({ ebookId: input.request.ebookId, mode: "automatic_undo",
      originalMatchingOperation: input.request.originalOperation }, context);
    expect(result.request).toEqual(input.request); expect(result.preview.keptCopy).toBe(true);
    expect(result.preview.retained).toEqual(input.plan.cleanup.retained);
    expect(result.capabilities).toEqual({ canApply: true, canUndo: false });
    expect(mocks.plan).toHaveBeenCalledWith({}, input.before.matchingLinkReceipt, target, undefined,
      { reviewUnlink: input.plan.reviewUnlink });
    expect(mocks.defaultPlan).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
    expect((await reviewPreviewCache.requireUnlink(result.previewToken, result.request, "api", target, async () => ({}))).envelope.plan).toEqual(input.plan);
  });
  it("refuses a replaced displayed native identity and later automatic metadata before core planning", async () => {
    const input = unlinkFixture(target);
    mocks.before.mockResolvedValue(input.before); mocks.after.mockResolvedValue(input.plan.reviewUnlink.matchingAfterEbookText);
    await expect(prepareEbookUnlinkReview({ ebookId: input.request.ebookId, mode: "unlink",
      originalMatchingOperation: input.request.operation }, context)).rejects.toMatchObject({ code: "operation_collision" });
    const raw = JSON.parse(input.before.rawEbookSnapshotText); raw.title = "Later metadata";
    mocks.before.mockResolvedValue({ ...input.before, rawEbookSnapshotText: JSON.stringify(raw) });
    await expect(prepareEbookUnlinkReview({ ebookId: input.request.ebookId, mode: "automatic_undo" }, context))
      .rejects.toMatchObject({ code: "stale_review" });
    expect(mocks.plan).not.toHaveBeenCalled(); expect(mocks.defaultPlan).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it("accepts a fresh unlink current row with later metadata through that same policy overload", async () => {
    const input = unlinkFixture(target), raw = JSON.parse(input.before.rawEbookSnapshotText); raw.title = "Later metadata";
    mocks.before.mockResolvedValue({ ...input.before, rawEbookSnapshotText: JSON.stringify(raw) });
    mocks.after.mockResolvedValue(input.plan.reviewUnlink.matchingAfterEbookText);
    mocks.plan.mockImplementation(async (_conn, _receipt, _target, _now, { reviewUnlink }) => ({
      kind: "planned", plan: { ...input.plan, reviewUnlink },
    }));
    const result = await prepareEbookUnlinkReview({ ebookId: input.request.ebookId, mode: "unlink" }, context);
    expect(result.preview.mode).toBe("unlink");
    expect(mocks.plan.mock.calls[0][4].reviewUnlink.rawEbookSnapshotText).toContain("Later metadata");
    expect(mocks.defaultPlan).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it("replays before cache/target loss and never calls another planner or writer", async () => {
    const input = unlinkFixture(target), receipt = { ...input.seed, after: {
      ...input.before.snapshot, matchState: "pending", instanceId: null, updatedAt: "2026-10-10T10:00:01.000001Z" } };
    mocks.read.mockResolvedValue({ receipt }); mocks.replay.mockResolvedValue(receipt);
    const result = await applyEbookUnlinkReview({ request: input.request, previewToken: "0".repeat(64) }, context);
    expect(result.undo).toEqual({ available: false, originalOperation: null }); expect(result.keptCopy).toBe(true);
    expect(mocks.plan).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("refuses absent receipt/missing preview and a colliding receipt without writing", async () => {
    const input = unlinkFixture(target), transport = { request: input.request, previewToken: "0".repeat(64) };
    mocks.read.mockResolvedValue(null);
    await expect(applyEbookUnlinkReview(transport, context)).rejects.toMatchObject({ code: "preview_expired" });
    mocks.read.mockResolvedValue({ receipt: {} }); mocks.replay.mockRejectedValue(new Error("colliding request"));
    await expect(applyEbookUnlinkReview(transport, context)).rejects.toThrow("colliding");
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it("resolves lost acknowledgement by one receipt lookup and never repeats the writer", async () => {
    const input = unlinkFixture(target), token = reviewPreviewCache.issueUnlink(input, "api", target);
    const receipt = { ...input.seed, after: { ...input.before.snapshot,
      matchState: "pending", instanceId: null, updatedAt: "2026-10-10T10:00:01.000001Z" } };
    mocks.read.mockResolvedValueOnce(null).mockResolvedValueOnce({ receipt });
    mocks.prepare.mockReturnValue({ extension: {}, readCommitted: vi.fn() });
    mocks.write.mockRejectedValue(new Error("lost acknowledgement")); mocks.replay.mockResolvedValue(receipt);
    expect((await applyEbookUnlinkReview({ request: input.request, previewToken: token }, context)).operation).toEqual(input.request.operation);
    expect(mocks.read).toHaveBeenCalledTimes(2); expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.plan).not.toHaveBeenCalled(); expect(mocks.replay).toHaveBeenCalledTimes(1);
    expect(mocks.prepare.mock.calls[0][0].seed.originalOperation).toBeNull();
  });
  it("keeps an unconfirmed write outcome tied to the original request", async () => {
    const input = unlinkFixture(target), token = reviewPreviewCache.issueUnlink(input, "api", target);
    mocks.read.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("lookup unavailable"));
    mocks.prepare.mockReturnValue({ extension: {} }); mocks.write.mockRejectedValue(new Error("ack unavailable"));
    await expect(applyEbookUnlinkReview({ request: input.request, previewToken: token }, context))
      .rejects.toMatchObject({ code: "outcome_unknown_retry_original" });
    expect(mocks.write).toHaveBeenCalledTimes(1); expect(mocks.plan).not.toHaveBeenCalled();
  });
});
