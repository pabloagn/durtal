import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewError } from "@/lib/ebooks/review/errors";
import { workId, operation } from "./review-ui-fixtures";
import { preparedWork, workOutcome } from "./work-review-ui-fixtures";
const api = vi.hoisted(() => ({ prepareWorkReview: vi.fn(), confirmWorkReview: vi.fn(), undoWorkReview: vi.fn() }));
vi.mock("@/lib/actions/ebook-review", () => api);
import { prepareWorkReviewUi, confirmWorkReviewUi, undoWorkReviewUi } from "@/lib/actions/work-review-ui";
beforeEach(() => { vi.resetAllMocks(); api.prepareWorkReview.mockResolvedValue(preparedWork()); api.confirmWorkReview.mockResolvedValue(workOutcome()); });
describe("actual work status adapters", () => {
  it("checks the shown status against the actual frozen protected stamp", async () => {
    expect(await prepareWorkReviewUi({ intent: { action: "mark_accessioned", workId }, expectedStatus: "wanted" })).toEqual({ ok: true, value: preparedWork() });
    expect(api.prepareWorkReview).toHaveBeenCalledWith({ action: "mark_accessioned", workId });
    expect(await prepareWorkReviewUi({ intent: { action: "mark_accessioned", workId }, expectedStatus: "tracked" })).toMatchObject({ ok: false, error: { code: "stale_review" } });
    expect(api.confirmWorkReview).not.toHaveBeenCalled();
  });
  it("rejects fabricated fields/status/id before service preparation", async () => {
    for (const input of [{ intent: { action: "mark_accessioned", workId: "bad" }, expectedStatus: "wanted" },
      { intent: { action: "mark_accessioned", workId }, expectedStatus: "accessioned" },
      { intent: { action: "mark_accessioned", workId, stamp: preparedWork().request.stamp }, expectedStatus: "wanted" }])
      expect(await prepareWorkReviewUi(input)).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(api.prepareWorkReview).not.toHaveBeenCalled();
  });
  it("keeps the exact request/token and original Undo operation across uncertainty", async () => {
    const input = { request: preparedWork().request, previewToken: preparedWork().previewToken };
    api.confirmWorkReview.mockRejectedValueOnce(new ReviewError("outcome_unknown_retry_original", "private SQL"));
    expect(await confirmWorkReviewUi(input)).toMatchObject({ ok: false, error: { retryOriginal: true } });
    expect(await confirmWorkReviewUi(input)).toMatchObject({ ok: true });
    expect(api.confirmWorkReview.mock.calls).toEqual([[input], [input]]);
    api.undoWorkReview.mockRejectedValueOnce(new ReviewError("stale_review", "raw dependencies"));
    expect(await undoWorkReviewUi({ workId, originalOperation: operation })).toMatchObject({ ok: false, error: { code: "stale_review" } });
    expect(api.undoWorkReview).toHaveBeenCalledWith({ workId, originalOperation: operation });
    expect(api.prepareWorkReview).not.toHaveBeenCalled();
  });
});
