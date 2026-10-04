import { describe, expect, it, vi } from "vitest";
import {
  needsViewLoad,
  viewDataStatus,
  type ViewDataState,
} from "@/lib/hooks/use-view-data";

type Query = { search?: string };

describe("useViewData state", () => {
  const retry = () => {};

  it("loads nothing while the view is hidden", () => {
    const query: Query = {};
    expect(needsViewLoad(false, query, null)).toBe(false);
    expect(viewDataStatus(false, query, null, retry)).toEqual({ status: "idle" });
  });

  it("keeps loaded data when the same server props come back (view switch)", () => {
    const query: Query = { search: "nadas" };
    const state: ViewDataState<Query, string[]> = { query, status: "ready", data: ["a"] };
    expect(needsViewLoad(true, query, state)).toBe(false);
    expect(viewDataStatus(true, query, state, retry)).toEqual({ status: "ready", data: ["a"] });
  });

  // Regression (PR #7 review): after router.refresh the page sends new props
  // with the same search and filters; the old data must not stay on screen.
  it("reloads after a refresh sends a new query object with equal content", () => {
    const before: Query = { search: "nadas" };
    const state: ViewDataState<Query, string[]> = { query: before, status: "ready", data: ["old"] };
    const afterRefresh: Query = { search: "nadas" };
    expect(afterRefresh).toEqual(before);
    expect(needsViewLoad(true, afterRefresh, state)).toBe(true);
    expect(viewDataStatus(true, afterRefresh, state, retry)).toEqual({ status: "loading" });
  });

  // Regression (PR #7 review): a failed load stayed on "Loading..." forever.
  it("shows an error with a retry action after a failed load", () => {
    const query: Query = {};
    const onRetry = vi.fn();
    const state: ViewDataState<Query, string[]> = { query, status: "error" };
    expect(needsViewLoad(true, query, state)).toBe(false);
    const view = viewDataStatus(true, query, state, onRetry);
    expect(view.status).toBe("error");
    if (view.status === "error") view.retry();
    expect(onRetry).toHaveBeenCalledOnce();
    // Retry clears the state, which loads again
    expect(needsViewLoad(true, query, null)).toBe(true);
  });
});
