// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseReviewParams } from "@/lib/ebooks/review-queue/params";
import { REVIEW_SECTIONS, type ReviewQueue } from "@/lib/ebooks/review-queue/types";
vi.mock("@/lib/actions/ebook-review-ui", () => ({ prepareReviewUi: vi.fn(), confirmReviewUi: vi.fn(), readReviewUi: vi.fn(), undoReviewUi: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-selection-ui", () => ({ prepareReviewSelectionUi: vi.fn(), prepareAcceptReviewSelectionUi: vi.fn(), confirmReviewSelectionUi: vi.fn(), undoReviewSelectionUi: vi.fn() }));
vi.mock("@/lib/actions/work-review-ui", () => ({ prepareWorkReviewUi: vi.fn(), confirmWorkReviewUi: vi.fn(), undoWorkReviewUi: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-pages-ui", () => ({ readReviewSelectionPageUi: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-unlink-ui", () => ({ prepareReviewUnlinkUi: vi.fn(), confirmReviewUnlinkUi: vi.fn(), readReviewUnlinkTargetUi: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: ({ children }: { children: ReactNode }) => createElement("div", { role: "dialog" }, children) }));
vi.mock("@/components/ebooks/choose-book-dialog", () => ({ ChooseBookFields: () => null }));
vi.mock("@/components/ebooks/new-book-dialog", () => ({ NewBookFields: () => null }));
import { ReviewView } from "@/app/(catalogue)/ebooks/review/review-view";

// An empty queue says why, and a filtered one offers to clear its filters
// (loading-states audit, finding 9).
let root: Root; let host: HTMLElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const counts = Object.fromEntries(REVIEW_SECTIONS.map(({ key }) => [key, 0])) as ReviewQueue["counts"];
async function render(raw: Record<string, string>) {
  await act(async () => root.render(createElement(ReviewView, { params: parseReviewParams(raw), queue: { counts, sections: [], page: 1 } })));
}
const clear = () => [...host.querySelectorAll("a")].find((link) => /^Clear/.test(link.textContent ?? ""));

describe("Review queue empty state", () => {
  it("with filters, says nothing matches and clears them, keeping the section", async () => {
    await render({ format: "epub", language: "French", section: "likely" });
    expect(host.querySelector("h3")?.textContent).toBe("No eBooks found");
    expect(clear()?.textContent).toBe("Clear filters");
    expect(clear()?.getAttribute("href")).toBe("/ebooks/review?section=likely");
  });

  it("with a search, clears the search", async () => {
    await render({ q: "huysmans" });
    expect(host.textContent).toContain('No eBooks match "huysmans".');
    expect(clear()?.textContent).toBe("Clear search");
    expect(clear()?.getAttribute("href")).toBe("/ebooks/review");
  });

  it("with no filters, says there is nothing to review and offers no clear", async () => {
    await render({});
    expect(host.querySelector("h3")?.textContent).toBe("No eBooks to review");
    expect(clear()).toBeUndefined();
  });
});
