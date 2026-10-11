import { beforeEach, describe, expect, it, vi } from "vitest";
import { decisionFixture } from "./fixtures";
import type { Db } from "@/lib/catalogue/work-store";
import { databaseFingerprint } from "@/lib/ebooks/ingest/command";
import { REVIEW_RECEIPT_EVENTS } from "@/lib/ebooks/review/receipts";

const mocks = vi.hoisted(() => ({ read: vi.fn(), replay: vi.fn(), prepare: vi.fn() }));
vi.mock("@/lib/enrichment/read-only-session", () => ({
  withReadOnlyPlanningConnection: async (_url: string, run: (conn: object) => unknown) => run({}),
}));
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(),
  CACHE_TAGS: { works: "works", editions: "editions", activity: "activity", authors: "authors", series: "series" } }));
vi.mock("@/lib/ebooks/review/store", async (original) => ({
  ...await original<typeof import("@/lib/ebooks/review/store")>(),
  readReviewReceiptOn: mocks.read, replayReviewDecisionOn: mocks.replay, prepareReviewAtomicWrite: mocks.prepare,
}));
import { applyEbookReview } from "@/lib/ebooks/review/service";

describe("shared service durable replay boundary", () => {
  beforeEach(() => vi.clearAllMocks());
  it("replays a durable operation before any preview cache or write preparation, including cache loss", async () => {
    const input = decisionFixture(), url = "postgresql://fixture@localhost/sln496_ebook_review";
    const target = databaseFingerprint(url);
    const request = { ...input.requests[0], operation: { ...input.requests[0].operation, targetDatabase: target } };
    const receipt = { ...input.seeds[0], operation: request.operation,
      after: { ...input.seeds[0].before, matchState: "standalone", updatedAt: "2026-10-10T10:00:00.123457Z" } };
    mocks.read.mockResolvedValue({ receipt });
    mocks.replay.mockResolvedValue(receipt);
    const result = await applyEbookReview(request, "0".repeat(64),
      { channel: "api", planningUrl: url, writeDb: {} as Db, targetDatabase: target });
    expect(result.operation).toEqual(request.operation);
    expect(result.message).toBe("Kept.");
    expect(result.undo.originalOperation).toEqual(request.operation);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.replay).toHaveBeenCalledTimes(1);
  });
  it("refuses an absent receipt and missing cache without preparing another plan or receipt", async () => {
    const input = decisionFixture(), url = "postgresql://fixture@localhost/sln496_ebook_review";
    const target = databaseFingerprint(url);
    const request = { ...input.requests[0], operation: { ...input.requests[0].operation, targetDatabase: target } };
    mocks.read.mockResolvedValue(null);
    await expect(applyEbookReview(request, "0".repeat(64),
      { channel: "api", planningUrl: url, writeDb: {} as Db, targetDatabase: target }))
      .rejects.toMatchObject({ code: "preview_expired" });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.replay).not.toHaveBeenCalled();
  });
  it("does not transform a colliding durable receipt into another write", async () => {
    const input = decisionFixture(), url = "postgresql://fixture@localhost/sln496_ebook_review";
    const target = databaseFingerprint(url);
    const request = { ...input.requests[0], operation: { ...input.requests[0].operation, targetDatabase: target } };
    mocks.read.mockResolvedValue({ receipt: { eventKey: REVIEW_RECEIPT_EVENTS.ebookDecision } });
    mocks.replay.mockRejectedValue(new Error("colliding durable request"));
    await expect(applyEbookReview(request, "0".repeat(64),
      { channel: "api", planningUrl: url, writeDb: {} as Db, targetDatabase: target })).rejects.toThrow("colliding");
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
});
