import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ getReviewSelectionPage: vi.fn() }));
vi.mock("@/lib/ebooks/review-queue/queries", () => api);
import { readReviewSelectionPageUi } from "@/lib/actions/ebook-review-pages-ui";
import { ebookId, workId } from "./review-ui-fixtures";
beforeEach(() => { vi.resetAllMocks(); api.getReviewSelectionPage.mockResolvedValue({ rows: [], count: 0, nextCursor: null }); });
describe("read-only filtered selection transport", () => {
  it("passes normalized scope/cursor to the bounded read without creating a plan", async () => {
    expect(await readReviewSelectionPageUi({ section: "likely", filters: { author: workId }, cursor: ebookId })).toMatchObject({ ok: true });
    expect(api.getReviewSelectionPage).toHaveBeenCalledWith({ section: "likely", filters: { author: workId }, cursor: ebookId });
  });
  it.each([{ section: "automatic", filters: {} }, { section: "partially_held", filters: {} },
    { section: "likely", filters: {}, cursor: "bad" }, { section: "likely", filters: {}, limit: 6000 },
    { section: "likely", filters: { work: "not-an-id" } }])("rejects unsupported scope %j before reading", async (input) => {
    expect(await readReviewSelectionPageUi(input)).toMatchObject({ ok: false, error: { code: "invalid_input" } });
    expect(api.getReviewSelectionPage).not.toHaveBeenCalled();
  });
});
