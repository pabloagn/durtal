// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// SLN-967: E S and E R worked, but neither page showed its key: the edit sat
// only in the Actions menu. Both now have the labelled Edit of every other
// detail page, whose tooltip gives the key.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/series/s1",
}));
vi.mock("@/lib/actions/series", () => ({ deleteSeries: vi.fn() }));
vi.mock("@/lib/actions/recommenders", () => ({ deleteRecommender: vi.fn() }));
vi.mock("@/components/shortcuts/shortcuts-provider", () => ({ useEditActions: () => {} }));
vi.mock("@/components/series/series-form-dialog", () => ({ SeriesFormDialog: ({ open }: { open: boolean }) => (open ? createElement("div", { id: "edit-series" }) : null) }));
vi.mock("@/components/series/add-series-books-dialog", () => ({ AddSeriesBooksDialog: () => null }));
vi.mock("@/components/recommenders/recommender-form-dialog", () => ({
  RecommenderFormDialog: ({ open }: { open: boolean }) => (open ? createElement("div", { id: "edit-recommender" }) : null),
}));
vi.mock("@/app/(catalogue)/library/[slug]/delete-confirm-dialog", () => ({ DeleteConfirmDialog: () => null }));

import { SeriesActions } from "@/components/series/series-actions";
import { RecommenderActions } from "@/app/(catalogue)/recommenders/[id]/recommender-actions";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
let host: HTMLElement, root: Root;
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const edit = () => [...host.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent === "Edit");

describe("the Edit control", () => {
  it("on a series page shows E S and opens the series' editor", () => {
    act(() => root.render(createElement(SeriesActions, {
      series: { id: "s1", title: "Les Rougon-Macquart", originalTitle: null, description: null, totalVolumes: 20, isComplete: true },
      bookCount: 3,
    })));
    expect(edit()?.dataset.tooltip).toBe("Edit series");
    expect(edit()?.dataset.tooltipKeys).toBe("e then s");
    act(() => edit()!.click());
    expect(document.getElementById("edit-series")).not.toBeNull();
  });

  it("on a recommender page shows E R and opens the recommender's editor", () => {
    act(() => root.render(createElement(RecommenderActions, {
      recommender: { id: "r1", name: "Gaston Bachelard", url: null },
      bookCount: 2,
    })));
    expect(edit()?.dataset.tooltip).toBe("Edit recommender");
    expect(edit()?.dataset.tooltipKeys).toBe("e then r");
    act(() => edit()!.click());
    expect(document.getElementById("edit-recommender")).not.toBeNull();
  });
});
