import { beforeEach, describe, expect, it, vi } from "vitest";
import { decisionFixture, ebookId, operation } from "./fixtures";
import type { Db } from "@/lib/catalogue/work-store";
import type { AccessionPlan } from "@/lib/ebooks/match/accession";
import { databaseFingerprint } from "@/lib/ebooks/ingest/command";
import { ReviewError } from "@/lib/ebooks/review/errors";

const mocks = vi.hoisted(() => ({ singlePrepare: vi.fn(), singleApply: vi.fn(), undo: vi.fn(),
  plan: vi.fn(), write: vi.fn(), before: vi.fn(), read: vi.fn(), replay: vi.fn(), prepare: vi.fn() }));
vi.mock("@/lib/enrichment/read-only-session", () => ({
  withReadOnlyPlanningConnection: async (_url: string, run: (db: object) => unknown) => run({}),
}));
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(), CACHE_TAGS: {
  works: "works", editions: "editions", activity: "activity", authors: "authors", series: "series" } }));
vi.mock("@/lib/ebooks/match/accession", () => ({ planAccessionOn: mocks.plan, accessionEbooks: mocks.write }));
// The confirm reads the catalogue again; the fixture plan was made on an empty one.
vi.mock("@/lib/ebooks/match/load", async (original) => ({
  ...await original<typeof import("@/lib/ebooks/match/load")>(), loadMatchRows: async () => ({}),
}));
vi.mock("@/lib/ebooks/review/store", async (original) => ({
  ...await original<typeof import("@/lib/ebooks/review/store")>(), readReviewBeforeOn: mocks.before,
  readReviewReceiptOn: mocks.read, replayReviewDecisionSetOn: mocks.replay, prepareReviewAtomicWrite: mocks.prepare,
}));
vi.mock("@/lib/ebooks/review/service", async (original) => ({
  ...await original<typeof import("@/lib/ebooks/review/service")>(), prepareEbookReview: mocks.singlePrepare,
  applyEbookReview: mocks.singleApply, undoEbookReview: mocks.undo,
}));
import { applyEbookReviewSelection, prepareEbookReviewSelection, undoEbookReviewSelection } from "@/lib/ebooks/review/bulk";

const otherId = "00000000-0000-4000-8000-000000000004", thirdId = "00000000-0000-4000-8000-000000000006";
const url = "postgresql://fixture@localhost/sln496_ebook_review", target = databaseFingerprint(url);
const context = { channel: "api" as const, planningUrl: url, targetDatabase: target, writeDb: {} as Db };
const ids = [ebookId, otherId];
const intents = () => ids.map((id) => ({ action: "accession", ebookId: id, language: "en" }));
/** Mock boundaries verify service orchestration only. They are never actual
 * stored receipt/core capability or SQL commit evidence. Real DB fixture follows. */
function fixture() {
  const before = decisionFixture().beforeReads[0];
  const entries = ids.map((id, index) => ({
    effect: { ebookId: id, text: "Creates fixture book", ready: true,
      copy: { locationId: thirdId, format: "epub", fileSizeBytes: 123, status: "available" } },
    receipt: { ...operation, targetDatabase: target,
      operationId: index ? "00000000-0000-4000-8000-000000000005" : operation.operationId },
  }));
  const plan = { ...operation, targetDatabase: target, operationId: thirdId, kind: "accession_batch", mode: "ingestion",
    createdAt: "2026-10-10T12:00:00.000Z", modelFingerprint: "a".repeat(64),
    authors: [], series: [], snapshot: { rows: {}, catalogueFingerprint: "b".repeat(64), inputFingerprint: "c".repeat(64) }, entries } as unknown as AccessionPlan;
  mocks.plan.mockResolvedValue(plan);
  mocks.before.mockImplementation(async (_db, id) => ({ ...before, ebookId: id }));
  return { before, plan };
}
describe("public bounded review selection service", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue(null); fixture(); });
  it("prepares only one ordinary core operation and explicitly defers the remaining ordered selection", async () => {
    const request = { ...decisionFixture().requests[0], operation: { ...operation, targetDatabase: target } };
    mocks.singlePrepare.mockResolvedValue({ request, previewToken: "0".repeat(64),
      preview: { text: "Keep", format: null, fileSizeBytes: null, locationId: null }, capabilities: { canUndo: true } });
    const prepared = await prepareEbookReviewSelection({ intents: [{ action: "keep", ebookId }, ...intents().slice(1)] }, context);
    expect(prepared.preparedCount).toBe(1); expect(prepared.selectionCount).toBe(2);
    expect(prepared.deferredIntents).toEqual(intents().slice(1));
    expect(mocks.singlePrepare).toHaveBeenCalledTimes(1); expect(mocks.plan).not.toHaveBeenCalled();
    mocks.singleApply.mockResolvedValue({ ebookId });
    expect((await applyEbookReviewSelection({ requests: prepared.requests, previewToken: prepared.previewToken }, context)).outcomes).toEqual([{ ebookId }]);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("confirms the frozen homogeneous prefix once and returns actual decoder outcomes in requested order", async () => {
    const prepared = await prepareEbookReviewSelection({ intents: [...intents(), { action: "keep", ebookId: thirdId }] }, context);
    expect(prepared.preparedCount).toBe(2); expect(prepared.deferredIntents).toEqual([{ action: "keep", ebookId: thirdId }]);
    const readCommitted = vi.fn(() => prepared.requests.map((request) => ({
      entityId: request.ebookId, action: "accession", operation: request.operation,
      outcome: { message: "Created", keptCopy: false } })).reverse());
    mocks.prepare.mockReturnValue({ extension: {}, readCommitted });
    const result = ["actual awaited result list"]; mocks.write.mockResolvedValue({ result, receipts: ["not authoritative"] });
    const outcome = await applyEbookReviewSelection({ requests: prepared.requests, previewToken: prepared.previewToken }, context);
    expect(mocks.write).toHaveBeenCalledTimes(1); expect(mocks.plan).toHaveBeenCalledTimes(1);
    expect(readCommitted).toHaveBeenCalledWith(result);
    expect(outcome.outcomes.map((row) => row.ebookId)).toEqual(ids);
    const input = mocks.prepare.mock.calls[0][0];
    expect(input.binding.ebookIds).toEqual(ids); expect(input.seeds).toHaveLength(2);
    expect(input.frozenEnvelopeHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("replays the complete durable set before cache loss without issuing a writer; partial evidence refuses", async () => {
    const prepared = await prepareEbookReviewSelection({ intents: intents() }, context);
    const receipts = prepared.requests.map((request) => ({ entityId: request.ebookId, action: "accession", operation: request.operation,
      outcome: { message: "Created", keptCopy: false } }));
    mocks.read.mockResolvedValueOnce({ receipt: receipts[0] }).mockResolvedValueOnce({ receipt: receipts[1] });
    mocks.replay.mockResolvedValue(receipts);
    expect((await applyEbookReviewSelection({ requests: prepared.requests, previewToken: "0".repeat(64) }, context)).outcomes).toHaveLength(2);
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
    mocks.read.mockResolvedValueOnce({ receipt: receipts[0] }).mockResolvedValueOnce(null);
    await expect(applyEbookReviewSelection({ requests: prepared.requests, previewToken: prepared.previewToken }, context))
      .rejects.toMatchObject({ code: "operation_collision" });
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("resolves a lost response once under the same complete operation set without another plan/write", async () => {
    const prepared = await prepareEbookReviewSelection({ intents: intents() }, context);
    mocks.prepare.mockReturnValue({ extension: {}, readCommitted: vi.fn() });
    mocks.write.mockRejectedValue(new Error("lost ack"));
    const receipts = prepared.requests.map((request) => ({ entityId: request.ebookId, action: "accession", operation: request.operation,
      outcome: { message: "Created", keptCopy: false } }));
    mocks.read.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ receipt: receipts[0] }).mockResolvedValueOnce({ receipt: receipts[1] });
    mocks.replay.mockResolvedValue(receipts);
    const result = await applyEbookReviewSelection({ requests: prepared.requests, previewToken: prepared.previewToken }, context);
    expect(result.outcomes).toHaveLength(2); expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.plan).toHaveBeenCalledTimes(1); expect(mocks.replay).toHaveBeenCalledTimes(1);
  });
  it("does not regenerate a missing/expired confirmed batch", async () => {
    const prepared = await prepareEbookReviewSelection({ intents: intents() }, context);
    await expect(applyEbookReviewSelection({ requests: prepared.requests, previewToken: "0".repeat(64) }, context))
      .rejects.toMatchObject({ code: "preview_expired" });
    expect(mocks.plan).toHaveBeenCalledTimes(1); expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("preserves earlier Undo outcomes and stops before later originals after a refusal or unknown result", async () => {
    const requests = [ebookId, otherId, thirdId].map((id) => ({ ebookId: id,
      originalOperation: { ...operation, operationId: id, targetDatabase: target } }));
    mocks.undo.mockResolvedValueOnce({ ebookId }).mockRejectedValueOnce(new ReviewError("stale_review", "Later decision."));
    const result = await undoEbookReviewSelection({ requests }, context);
    expect(result.rows[0]).toEqual({ status: "committed", outcome: { ebookId } });
    expect(result.rows[1]).toMatchObject({ status: "refused", ebookId: otherId });
    expect(result.deferredRequests).toEqual([requests[2]]); expect(mocks.undo).toHaveBeenCalledTimes(2);
    mocks.undo.mockClear(); mocks.undo.mockRejectedValueOnce(new Error("network uncertainty"));
    expect((await undoEbookReviewSelection({ requests }, context)).rows[0].status).toBe("unconfirmed");
    expect(mocks.undo).toHaveBeenCalledTimes(1);
  });
  it("rejects duplicated/over-limit selections before any preparation or write", async () => {
    await expect(prepareEbookReviewSelection({ intents: [intents()[0], intents()[0]] }, context)).rejects.toThrow();
    await expect(prepareEbookReviewSelection({ intents: Array.from({ length: 51 }, () => intents()[0]) }, context)).rejects.toThrow();
    expect(mocks.plan).not.toHaveBeenCalled(); expect(mocks.singlePrepare).not.toHaveBeenCalled();
  });
});
