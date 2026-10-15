import { beforeEach, describe, expect, it, vi } from "vitest";
import { workId } from "../ebooks/review-ui-fixtures";
const api = vi.hoisted(() => ({ refresh: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-suggestions", () => ({ refreshSuggestionsForCreatedBook: api.refresh }));
vi.mock("@/lib/notifications/toast", () => ({ toast: { info: api.info } }));
import { notifyCreatedBookSuggestions } from "@/lib/ebooks/review-queue/created-book-feedback";
beforeEach(() => vi.resetAllMocks());
describe("stored suggestions after confirmed creation", () => {
  it("uses the actual saved UUID and actual count for its Review action", async () => {
    api.refresh.mockResolvedValue({ workId, suggestionCount: 3, status: "ready" }); const open = vi.fn();
    await notifyCreatedBookSuggestions(workId, open);
    expect(api.refresh).toHaveBeenCalledWith({ workId }); expect(api.info.mock.calls[0][0]).toContain("3 eBook suggestions");
    api.info.mock.calls[0][1].action.onClick(); expect(open).toHaveBeenCalledWith(`/ebooks/review?work=${workId}`);
  });
  it("distinguishes a real empty result from unavailable or a lost suggestion response", async () => {
    api.refresh.mockResolvedValueOnce({ workId, suggestionCount: 0, status: "ready" });
    await notifyCreatedBookSuggestions(workId, vi.fn()); expect(api.info).not.toHaveBeenCalled();
    api.refresh.mockResolvedValueOnce({ workId, suggestionCount: 0, status: "unavailable" });
    await notifyCreatedBookSuggestions(workId, vi.fn()); expect(api.info).toHaveBeenLastCalledWith("Book added. eBook suggestions could not be checked yet.");
    api.refresh.mockRejectedValueOnce(new Error("lost response"));
    await expect(notifyCreatedBookSuggestions(workId, vi.fn())).resolves.toBeUndefined();
    expect(api.info.mock.calls).toHaveLength(2);
  });
});
