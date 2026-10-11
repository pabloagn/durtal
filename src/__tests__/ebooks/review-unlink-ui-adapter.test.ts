import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewError } from "@/lib/ebooks/review/errors";
import { ebookId, stamp, operation } from "./review-ui-fixtures";
import { preparedUnlink, unlinkOutcome, unlinkTarget } from "./review-unlink-ui-fixtures";
const api = vi.hoisted(() => ({ prepareReviewUnlink: vi.fn(), confirmReviewUnlink: vi.fn(), getReviewUnlinkTarget: vi.fn() }));
vi.mock("@/lib/actions/ebook-review", () => api);
vi.mock("@/lib/ebooks/review-queue/queries", () => ({ getReviewUnlinkTarget: api.getReviewUnlinkTarget }));
import { prepareReviewUnlinkUi, confirmReviewUnlinkUi, readReviewUnlinkTargetUi } from "@/lib/actions/ebook-review-unlink-ui";
function actualPrepared(mode: "automatic_undo" | "unlink" = "automatic_undo") {
  return { ...preparedUnlink(mode), preview: { ...preparedUnlink(mode).preview,
    deleted: { instances: [], editions: [], works: [], authors: [], series: [] },
    restoredCopy: { id: "private-copy-id", editionId: "private-edition-id", updatedAt: "private", arbitrary: "storage/path" },
    retained: [{ table: "instances", id: "private-copy-id", reason: "referenced" }] } };
}
beforeEach(() => { vi.resetAllMocks(); api.prepareReviewUnlink.mockResolvedValue(actualPrepared());
  api.confirmReviewUnlink.mockResolvedValue(unlinkOutcome()); api.getReviewUnlinkTarget.mockResolvedValue(unlinkTarget); });
describe("real F2 Next transport", () => {
  it("requires the exact rendered native identity and projects cleanup counts without internal rows", async () => {
    const intent = { ebookId, mode: "automatic_undo", originalMatchingOperation: operation };
    const result = await prepareReviewUnlinkUi({ intent, stamp });
    expect(api.prepareReviewUnlink).toHaveBeenCalledWith(intent);
    expect(result).toMatchObject({ ok: true, value: { request: preparedUnlink().request, previewToken: preparedUnlink().previewToken,
      preview: { restoredCopy: true, keptCopy: true, deleted: { copies: 0, editions: 0, books: 0, authors: 0, series: 0 } } } });
    expect(JSON.stringify(result)).not.toMatch(/private-copy-id|private-edition-id|storage\/path|arbitrary|retained/);
    expect(api.confirmReviewUnlink).not.toHaveBeenCalled();
  });
  it("rejects native-operation replacement and even one microsecond stamp drift without confirming", async () => {
    expect(await prepareReviewUnlinkUi({ intent: { ebookId, mode: "unlink", originalMatchingOperation: { ...operation, planSha256: "e".repeat(64) } }, stamp }))
      .toMatchObject({ ok: false, error: { code: "operation_collision" } });
    expect(await prepareReviewUnlinkUi({ intent: { ebookId, mode: "automatic_undo", originalMatchingOperation: operation },
      stamp: { ...stamp, updatedAt: "2026-10-10T10:00:00.000002Z" } })).toMatchObject({ ok: false, error: { code: "stale_review" } });
    expect(api.confirmReviewUnlink).not.toHaveBeenCalled();
  });
  it("refuses missing guard, untrusted mode and malformed read identity before calling services", async () => {
    for (const intent of [{ ebookId, mode: "unlink" }, { ebookId, mode: "inverse", originalMatchingOperation: operation }])
      expect(await prepareReviewUnlinkUi({ intent, stamp })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(api.prepareReviewUnlink).not.toHaveBeenCalled();
    expect(await readReviewUnlinkTargetUi({ ebookId: "bad" })).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(api.getReviewUnlinkTarget).not.toHaveBeenCalled();
  });
  it("uses a fresh visible unlink mode and retries an unknown confirmation under the same exact request/token", async () => {
    api.prepareReviewUnlink.mockResolvedValue(actualPrepared("unlink"));
    expect(await prepareReviewUnlinkUi({ intent: { ebookId, mode: "unlink", originalMatchingOperation: operation }, stamp })).toMatchObject({ ok: true });
    const input = { request: preparedUnlink("unlink").request, previewToken: preparedUnlink("unlink").previewToken };
    api.confirmReviewUnlink.mockRejectedValueOnce(new ReviewError("outcome_unknown_retry_original", "secret SQL"));
    expect(await confirmReviewUnlinkUi(input)).toMatchObject({ ok: false, error: { retryOriginal: true } });
    expect(await confirmReviewUnlinkUi(input)).toEqual({ ok: true, value: unlinkOutcome() });
    expect(api.confirmReviewUnlink.mock.calls).toEqual([[input], [input]]);
    expect(api.prepareReviewUnlink).toHaveBeenCalledOnce();
  });
});
