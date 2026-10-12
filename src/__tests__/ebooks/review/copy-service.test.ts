import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/lib/catalogue/work-store";
import { decisionFixture } from "./fixtures";
import { databaseFingerprint } from "@/lib/ebooks/ingest/command";
const mock = vi.hoisted(() => ({ plan: vi.fn(), before: vi.fn(), read: vi.fn(), replay: vi.fn(), prepare: vi.fn(), acquisition: null as Promise<void> | null }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/enrichment/read-only-session", () => ({
  withReadOnlyPlanningConnection: async (_url: string, run: (conn: object) => unknown) => {
    if (mock.acquisition) await mock.acquisition;
    return run({});
  },
}));
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(), CACHE_TAGS: {} }));
vi.mock("@/lib/ebooks/match/link", async (original) => ({
  ...await original<typeof import("@/lib/ebooks/match/link")>(), planLinkOn: mock.plan,
}));
vi.mock("@/lib/ebooks/review/store", async (original) => ({
  ...await original<typeof import("@/lib/ebooks/review/store")>(), readReviewBeforeOn: mock.before,
  readReviewReceiptOn: mock.read, replayReviewDecisionOn: mock.replay, prepareReviewAtomicWrite: mock.prepare,
}));
import { prepareEbookReview, applyEbookReview } from "@/lib/ebooks/review/service";
const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const copyStamp = { updatedAt: "2026-10-11T10:00:00.123456Z", metadataFingerprint: "d".repeat(64) };
const url = "postgresql://fixture@localhost/copy_review", targetDatabase = databaseFingerprint(url);
const context = { channel: "ui" as const, planningUrl: url, writeDb: {} as Db, targetDatabase };
const intent = () => ({ action: "link" as const, ebookId: decisionFixture().beforeReads[0].ebookId, workId: id(1),
  choice: { kind: "fill_copy" as const, editionId: id(2), instanceId: id(3) },
  existingCopyPatch: { notes: "Chosen metadata" }, expectedCopyStamp: copyStamp });
function plan(changed = false) {
  const input = intent();
  return { ...decisionFixture().binding.coreOperation, targetDatabase, kind: "link",
    choices: { ...input, existingCopyPatch: changed ? { notes: "Different metadata" } : input.existingCopyPatch },
    effect: { text: "Attach the file to this copy", instanceId: id(3), editionId: id(2), newCopy: null,
      newEdition: null, filledCopy: { format: "epub", fileSizeBytes: 20 } },
    snapshot: { rows: { instances: [{ id: id(3), location_id: id(4) }] } } };
}
describe("one prepared native edit-and-link plan", () => {
  beforeEach(() => { vi.clearAllMocks(); mock.acquisition = null; mock.before.mockResolvedValue(decisionFixture().beforeReads[0]); });
  it("forwards exact metadata and copy guard to the actual link planner", async () => {
    mock.plan.mockResolvedValue(plan());
    const value = await prepareEbookReview(intent(), context);
    expect(mock.plan).toHaveBeenCalledTimes(1);
    expect(mock.plan.mock.calls[0][1]).toMatchObject({ method: "manual", instanceId: id(3), editionId: id(2),
      existingCopyPatch: intent().existingCopyPatch, expectedCopyStamp: copyStamp });
    expect(value.request).toMatchObject({ existingCopyPatch: intent().existingCopyPatch, expectedCopyStamp: copyStamp });
    expect(mock.prepare).not.toHaveBeenCalled();
  });
  it("rejects a planner which changes the metadata before issuing a token", async () => {
    mock.plan.mockResolvedValue(plan(true));
    await expect(prepareEbookReview(intent(), context)).rejects.toMatchObject({ code: "operation_collision" });
  });
  it("captures patch, stamp, selected copy and context before deferred connection acquisition", async () => {
    let release!: () => void;
    mock.acquisition = new Promise<void>((resolve) => { release = resolve; });
    mock.plan.mockImplementation(async (_conn, choices) => ({ ...plan(), choices }));
    const input = intent(), ctx = { ...context };
    // Keep this caller stamp independent of the shared test constant.
    input.expectedCopyStamp = { ...copyStamp };
    const pending = prepareEbookReview(input, ctx);
    input.existingCopyPatch.notes = "Mutated while acquiring";
    input.expectedCopyStamp.updatedAt = "2026-10-11T10:00:00.123457Z";
    input.choice.instanceId = id(9);
    ctx.targetDatabase = "Changed target"; ctx.planningUrl = "Changed URL";
    expect(mock.plan).not.toHaveBeenCalled();
    release();
    const value = await pending;
    expect(value.request).toMatchObject({ existingCopyPatch: { notes: "Chosen metadata" },
      expectedCopyStamp: copyStamp, choice: { instanceId: id(3) }, operation: { targetDatabase } });
    expect(Object.isFrozen(mock.plan.mock.calls[0][1].existingCopyPatch)).toBe(true);
  });
  it("replays the original durable patched request before cache or write preparation", async () => {
    mock.plan.mockResolvedValue(plan());
    const prepared = await prepareEbookReview(intent(), context);
    mock.plan.mockClear();
    const fixture = decisionFixture();
    const receipt = { ...fixture.seeds[0], action: "link", operation: prepared.request.operation,
      outcome: { message: "Edited and linked.", keptCopy: false } };
    mock.read.mockResolvedValue({ receipt }); mock.replay.mockResolvedValue(receipt);
    const value = await applyEbookReview(prepared.request, "0".repeat(64), context);
    expect(value.message).toBe("Edited and linked.");
    expect(mock.replay.mock.calls[0][2]).toEqual(prepared.request);
    expect(mock.prepare).not.toHaveBeenCalled(); expect(mock.plan).not.toHaveBeenCalled();
  });
});
