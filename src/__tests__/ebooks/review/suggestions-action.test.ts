import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ suggest: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/ebooks/match/suggest", () => ({ suggestForNewWork: mock.suggest }));
import { refreshSuggestionsForCreatedBook } from "@/lib/actions/ebook-review-suggestions";
const workId = "90000000-0000-4000-8000-000000000001";

describe("post-create stored suggestions", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns the actual core count for the actual saved book", async () => {
    mock.suggest.mockResolvedValue({ workId, suggestionCount: 3, status: "ready" });
    expect(await refreshSuggestionsForCreatedBook({ workId })).toEqual({ workId, suggestionCount: 3, status: "ready" });
    expect(mock.suggest).toHaveBeenCalledExactlyOnceWith(workId);
  });
  it("keeps suggestions unavailable when matching fails after creation", async () => {
    mock.suggest.mockRejectedValue(new Error("Candidate database unavailable"));
    expect(await refreshSuggestionsForCreatedBook({ workId })).toEqual({ workId, suggestionCount: 0, status: "unavailable" });
  });
  it("refuses an unrelated saved ID, malformed count and impossible unavailable count", async () => {
    for (const value of [ { workId: "90000000-0000-4000-8000-000000000002", suggestionCount: 2, status: "ready" },
      { workId, suggestionCount: -1, status: "ready" }, { workId, suggestionCount: 2, status: "unavailable" } ]) {
      mock.suggest.mockResolvedValue(value);
      expect(await refreshSuggestionsForCreatedBook({ workId })).toEqual({ workId, suggestionCount: 0, status: "unavailable" });
    }
  });
  it("validates the saved-ID boundary before calling any candidate refresh", async () => {
    for (const input of [{ workId: "draft" }, { workId, accept: true }])
      await expect(refreshSuggestionsForCreatedBook(input)).rejects.toThrow();
    expect(mock.suggest).not.toHaveBeenCalled();
  });
});
