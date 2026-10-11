import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ failure: "" as "" | "plan" | "write", events: [] as string[] }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({ DATABASE_URL: "postgres://localhost/sln495_source" }) }));
vi.mock("@/lib/cache", () => ({ CACHE_TAGS: { works: "works" }, invalidate: () => state.events.push("cache") }));
vi.mock("@/lib/enrichment/read-only-session", () => ({ withReadOnlyPlanningConnection:
  async (_url: string, run: (conn: unknown) => unknown, options: { isolationLevel: string }) => {
    expect(options.isolationLevel).toBe("repeatable read");return run({});
  } }));
vi.mock("@/lib/ebooks/match/work-suggestions", () => ({
  WORK_SUGGESTION_BOUNDS: {}, planSuggestionsForWorkOn: async () => {
    state.events.push("plan");if (state.failure === "plan") throw new Error("Unavailable database");return {};
  }, persistWorkSuggestions: async () => {
    state.events.push("write");if (state.failure === "write") throw new Error("Stale atomic");
    return { workId: "saved-book", suggestionCount: 2, status: "ready" };
  },
}));
import { suggestForNewWork } from "@/lib/ebooks/match/suggest";
describe("post-create suggestion service", () => {
  it.each(["plan", "write"] as const)("preserves created-book success on %s failure", async (failure) => {
    state.failure = failure;state.events = [];
    expect(await suggestForNewWork("saved-book")).toEqual({ workId: "saved-book", suggestionCount: 0, status: "unavailable" });
    expect(state.events).not.toContain("cache");
  });
  it("returns the committed count and refreshes book views", async () => {
    state.failure = "";state.events = [];
    expect(await suggestForNewWork("saved-book")).toEqual({ workId: "saved-book", suggestionCount: 2, status: "ready" });
    expect(state.events).toEqual(["plan", "write", "cache"]);
  });
});
