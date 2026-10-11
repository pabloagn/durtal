import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewError } from "@/lib/ebooks/review/errors";
import { ebookId, workId, stamp, preparedReview, reviewDetail, operation, reviewOutcome } from "./review-ui-fixtures";

const api = vi.hoisted(() => ({ prepareReviewSelection: vi.fn(), confirmReviewSelection: vi.fn(),
  undoReviewSelection: vi.fn(), readReview: vi.fn(), getReviewStamps: vi.fn() }));
vi.mock("@/lib/actions/ebook-review", () => api);
vi.mock("@/lib/ebooks/review-queue/queries", () => ({ getReviewStamps: api.getReviewStamps }));
import { prepareReviewSelectionUi, prepareAcceptReviewSelectionUi, confirmReviewSelectionUi, undoReviewSelectionUi } from "@/lib/actions/ebook-review-selection-ui";
const secondId = "66666666-6666-4666-8666-666666666666";
const intents = [{ action: "keep" as const, ebookId }, { action: "keep" as const, ebookId: secondId }];
const stamps = intents.map(({ ebookId: id }) => ({ ebookId: id, stamp }));
const prepared = () => ({ requests: [preparedReview().request], previewToken: preparedReview().previewToken,
  rows: [{ ebookId, text: "Keep this eBook", format: null, fileSizeBytes: null, locationId: null, canUndo: true }],
  preparedCount: 1, selectionCount: 2, deferredIntents: [intents[1]] });
beforeEach(() => {
  vi.resetAllMocks(); api.getReviewStamps.mockResolvedValue(new Map(stamps.map((row) => [row.ebookId, row.stamp])));
  api.prepareReviewSelection.mockResolvedValue(prepared()); api.confirmReviewSelection.mockResolvedValue({ outcomes: [reviewOutcome()] });
});
describe("bounded selection UI transport", () => {
  it("keeps the actual prepared prefix and deferred intents without expanding confirmation", async () => {
    expect(await prepareReviewSelectionUi({ intents, stamps })).toEqual({ ok: true, value: prepared() });
    expect(api.getReviewStamps).toHaveBeenCalledWith([ebookId, secondId]);
    expect(api.prepareReviewSelection).toHaveBeenCalledWith({ intents });
    expect(api.confirmReviewSelection).not.toHaveBeenCalled();
  });
  it("refuses all preparation when even a deferred rendered row changed by one microsecond", async () => {
    api.getReviewStamps.mockResolvedValue(new Map([[ebookId, stamp], [secondId, { ...stamp, updatedAt: "2026-10-10T10:00:00.000002Z" }]]));
    expect(await prepareReviewSelectionUi({ intents, stamps })).toMatchObject({ ok: false, error: { code: "stale_review", ebookIds: [secondId] } });
    expect(api.prepareReviewSelection).not.toHaveBeenCalled(); expect(api.confirmReviewSelection).not.toHaveBeenCalled();
  });
  it("rejects missing, duplicate and over-bound guards before reading or preparing", async () => {
    for (const input of [{ intents, stamps: stamps.slice(0, 1) }, { intents, stamps: [stamps[0], stamps[0]] },
      { intents: Array(51).fill(intents[0]), stamps: Array(51).fill(stamps[0]) }])
      expect(await prepareReviewSelectionUi(input)).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(api.getReviewStamps).not.toHaveBeenCalled(); expect(api.prepareReviewSelection).not.toHaveBeenCalled();
  });
  it("detects a race in the actual prepared stamp", async () => {
    api.prepareReviewSelection.mockResolvedValue({ ...prepared(), requests: [{ ...preparedReview().request, stamp: { ...stamp, matchFingerprint: "f".repeat(64) } }] });
    expect(await prepareReviewSelectionUi({ intents, stamps })).toMatchObject({ ok: false, error: { ebookIds: [ebookId] } });
    expect(api.confirmReviewSelection).not.toHaveBeenCalled();
  });
  it("loads a fresh eligible proof for only the first match, and reports its stale identity", async () => {
    api.readReview.mockResolvedValue({ ...reviewDetail(), candidates: [{ rank: 1, workId, title: "Nadja", probability: 1,
      eligible: true, effectText: "Link", candidateHash: "f".repeat(64) }] });
    expect(await prepareAcceptReviewSelectionUi({ ebookId, stamp, workId, rank: 1 })).toMatchObject({ ok: true });
    expect(api.prepareReviewSelection).toHaveBeenCalledWith({ intents: [{ action: "accept", ebookId, rank: 1, candidateHash: "f".repeat(64) }] });
    api.readReview.mockResolvedValue({ ...reviewDetail(), stamp: { ...stamp, matchFingerprint: "e".repeat(64) } });
    expect(await prepareAcceptReviewSelectionUi({ ebookId, stamp, workId, rank: 1 })).toMatchObject({ ok: false, error: { ebookIds: [ebookId] } });
    expect(api.prepareReviewSelection).toHaveBeenCalledOnce();
  });
  it("retries the exact original prepared set and token after an unknown outcome", async () => {
    const input = { requests: prepared().requests, previewToken: prepared().previewToken };
    api.confirmReviewSelection.mockRejectedValueOnce(new ReviewError("outcome_unknown_retry_original", "private SQL"));
    expect(await confirmReviewSelectionUi(input)).toMatchObject({ ok: false, error: { retryOriginal: true } });
    expect(await confirmReviewSelectionUi(input)).toMatchObject({ ok: true });
    expect(api.confirmReviewSelection.mock.calls).toEqual([[input], [input]]);
    expect(api.prepareReviewSelection).not.toHaveBeenCalled();
  });
  it("preserves stopped Undo identity, committed rows and deferred requests while sanitizing failures", async () => {
    const first = { ebookId, originalOperation: operation };
    const second = { ebookId: secondId, originalOperation: { ...operation, operationId: "77777777-7777-4777-8777-777777777777" } };
    api.undoReviewSelection.mockResolvedValue({ stopped: true, rows: [{ status: "committed", outcome: reviewOutcome() },
      { status: "unconfirmed", ...second, code: "invalid_receipt", message: "SELECT private_key FROM secret" }], deferredRequests: [] });
    const input = { requests: [first, second] };
    const result = await undoReviewSelectionUi(input);
    expect(result).toMatchObject({ ok: true, value: { stopped: true, rows: [{ status: "committed" }, { status: "unconfirmed", ...second }] } });
    expect(JSON.stringify(result)).not.toMatch(/SELECT|private_key|secret/);
    await undoReviewSelectionUi(input); expect(api.undoReviewSelection.mock.calls).toEqual([[input], [input]]);
  });
});
