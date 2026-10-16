// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReviewParams } from "@/lib/ebooks/review-queue/params";

// SLN-808: Lookup history read "1 lookups", and the e-book review counts over
// a thousand printed without a comma ("Review all 1107 filtered eBooks…").
const history = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/lib/reader/lookup/history", () => ({
  browserLookupHistoryStore: () => ({ count: async () => history.count, list: async () => [], close: () => {} }),
}));
vi.mock("@/components/catalogue/confirm-delete-dialog", () => ({ ConfirmDeleteDialog: () => null }));
vi.mock("@/components/shared/pagination", () => ({ Pagination: () => null }));
import { LookupHistoryGroup } from "@/app/(catalogue)/settings/reader/lookup-history";
import { ReviewSection } from "@/components/ebooks/review-section";

let root: Root; let host: HTMLElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function render(element: ReturnType<typeof createElement>) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(element));
}

describe("lookup history's count", () => {
  it.each([[0, "0 lookups"], [1, "1 lookup"], [2, "2 lookups"], [1234, "1,234 lookups"]])("%i reads %s", async (count, text) => {
    history.count = count;
    await render(createElement(LookupHistoryGroup));
    expect([...host.querySelectorAll("p")].map((p) => p.textContent)).toContain(text);
  });
});

describe("lookup history before its first read (SLN-875)", () => {
  it("says it is loading on the count's line, with no row that comes and goes", async () => {
    history.count = 0;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    act(() => root.render(createElement(LookupHistoryGroup)));
    const rows = () => host.querySelectorAll("section > div > div").length;
    const before = rows();
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Loading lookup history");
    await act(async () => {});
    expect([...host.querySelectorAll("p")].map((p) => p.textContent)).toContain("0 lookups");
    expect(rows()).toBe(before);
  });
});

describe("Review all in a review section", () => {
  it("groups thousands in its count", async () => {
    await render(createElement(ReviewSection, {
      section: "not_in_durtal", count: 1107, page: 1, rows: [], params: { filters: {} } as unknown as ReviewParams,
      renderRow: () => null, onAll: () => {},
    }));
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toContain("Review all 1,107 filtered eBooks…");
  });
});
