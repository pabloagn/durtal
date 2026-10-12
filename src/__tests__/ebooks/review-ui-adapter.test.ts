import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewError } from "@/lib/ebooks/review/errors";
import { reviewUiResult } from "@/lib/ebooks/review-queue/result";
import { ebookId, stamp, preparedReview, reviewDetail, reviewOutcome, operation } from "./review-ui-fixtures";

const actions = vi.hoisted(() => ({ prepareReview: vi.fn(), confirmReview: vi.fn(), readReview: vi.fn(), undoReview: vi.fn() }));
vi.mock("@/lib/actions/ebook-review", () => actions);
vi.mock("@/lib/ebooks/review-queue/queries", () => ({ getReviewWorkOptions: vi.fn(), searchReviewEbooks: vi.fn() }));
import { prepareReviewUi, confirmReviewUi, readReviewUi, undoReviewUi } from "@/lib/actions/ebook-review-ui";
beforeEach(() => {
  vi.resetAllMocks(); actions.prepareReview.mockResolvedValue(preparedReview());
  actions.confirmReview.mockResolvedValue(reviewOutcome()); actions.readReview.mockResolvedValue(reviewDetail());
});
describe("production-safe review adapters", () => {
  it("prepares a shared intent and refuses a timestamp differing by one microsecond", async () => {
    const raw = { intent: { action: "keep", ebookId }, stamp };
    expect(await prepareReviewUi(raw)).toEqual({ ok: true, value: preparedReview() });
    expect(actions.prepareReview).toHaveBeenCalledWith(raw.intent);
    const result = await prepareReviewUi({ ...raw, stamp: { ...stamp, updatedAt: "2026-10-10T10:00:00.000002Z" } });
    expect(result).toMatchObject({ ok: false, error: { code: "stale_review", retryOriginal: false } });
    expect(actions.confirmReview).not.toHaveBeenCalled();
  });
  it("refuses a changed candidate fingerprint while keeping canonical stamp strings", async () => {
    const result = await readReviewUi({ ebookId, stamp: { ...stamp, matchFingerprint: "e".repeat(64) } });
    expect(result).toMatchObject({ ok: false, error: { code: "stale_review" } });
    expect(actions.readReview).toHaveBeenCalledWith(ebookId);
  });
  it("confirms and retries exactly the original request and token", async () => {
    const prepared = preparedReview();
    actions.confirmReview.mockRejectedValueOnce(new ReviewError("outcome_unknown_retry_original", "private ORM cause"));
    const input = { request: prepared.request, previewToken: prepared.previewToken };
    expect(await confirmReviewUi(input)).toMatchObject({ ok: false, error: { code: "outcome_unknown_retry_original", retryOriginal: true } });
    expect(await confirmReviewUi(input)).toEqual({ ok: true, value: reviewOutcome() });
    expect(actions.confirmReview.mock.calls).toEqual([[prepared.request, prepared.previewToken], [prepared.request, prepared.previewToken]]);
    expect(actions.prepareReview).not.toHaveBeenCalled();
  });
  it("validates transport before invoking a writer", async () => {
    const result = await confirmReviewUi({ request: preparedReview().request, previewToken: "not-a-capability", surprise: true });
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(actions.confirmReview).not.toHaveBeenCalled();
  });
  it("uses the authoritative original operation for Undo", async () => {
    actions.undoReview.mockResolvedValue({ ...reviewOutcome(), keptCopy: true });
    expect(await undoReviewUi({ ebookId, originalOperation: operation })).toMatchObject({ ok: true, value: { keptCopy: true } });
    expect(actions.undoReview).toHaveBeenCalledWith({ ebookId, originalOperation: operation });
  });
  it.each(["stale_review", "preview_expired", "operation_collision", "invalid_receipt"] as const)("returns safe %s without SQL or planner payload", async (code) => {
    const result = await reviewUiResult(async () => { throw new ReviewError(code, "postgres://secret DELETE FROM works"); });
    expect(result).toMatchObject({ ok: false, error: { code, retryOriginal: false } });
    expect(JSON.stringify(result)).not.toMatch(/postgres|secret|DELETE/);
  });
  it("treats unexpected write errors as uncertain and unexpected reads as unavailable", async () => {
    const fail = async () => { throw new Error("secret SQL"); };
    expect(await reviewUiResult(fail, "write")).toMatchObject({ ok: false, error: { retryOriginal: true } });
    expect(await reviewUiResult(fail)).toMatchObject({ ok: false, error: { code: "unavailable", retryOriginal: false } });
  });
});
