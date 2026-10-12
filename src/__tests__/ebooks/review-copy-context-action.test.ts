import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyContext, copyId, editionId } from "./review-existing-copy-fixtures";
import { workId } from "./review-ui-fixtures";
const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/ebooks/review-queue/copy-context-query", () => ({ getReviewExistingCopyContext: api.read }));
import { readReviewExistingCopyUi } from "@/lib/actions/ebook-review-copy-ui";
beforeEach(() => vi.resetAllMocks());
describe("copy editor context boundary", () => {
  it("accepts only the actual work/edition/copy UUID tuple before the private read", async () => {
    for (const input of [{ workId, editionId, instanceId: "invalid" }, { workId, editionId },
      { workId, editionId, instanceId: copyId, metadata: {} }]) {
      expect(await readReviewExistingCopyUi(input)).toMatchObject({ ok: false, error: { code: "invalid_input", retryOriginal: false } });
    }
    expect(api.read).not.toHaveBeenCalled();
    api.read.mockResolvedValueOnce(copyContext());
    expect(await readReviewExistingCopyUi({ workId, editionId, instanceId: copyId })).toEqual({ ok: true, value: copyContext() });
    expect(api.read).toHaveBeenCalledWith({ workId, editionId, instanceId: copyId });
  });
  it("does not expose private query failures or offer an unguarded context", async () => {
    api.read.mockRejectedValueOnce(new Error("private database /native/file/path"));
    const result = await readReviewExistingCopyUi({ workId, editionId, instanceId: copyId });
    expect(result).toMatchObject({ ok: false, error: { code: "unavailable", retryOriginal: false } });
    expect(JSON.stringify(result)).not.toContain("private database");
  });
});
