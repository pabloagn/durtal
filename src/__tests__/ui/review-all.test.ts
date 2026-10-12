// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReviewQueueRow, ReviewOutcome } from "@/lib/ebooks/review-queue/types";
import { reviewRow, reviewOutcome, ebookId, workId } from "../ebooks/review-ui-fixtures";
const api = vi.hoisted(() => ({ readReviewSelectionPageUi: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-pages-ui", () => api);
vi.mock("@/components/ui/dialog", () => ({ Dialog: ({ children }: { children: ReactNode }) => createElement("div", { role: "dialog" }, children) }));
vi.mock("@/components/ebooks/review-bulk-dialog", () => ({ ReviewBulkDialog: ({ rows, onCommitted, onSkipped, onClose }: {
  rows: ReviewQueueRow[]; onCommitted: (outcomes: ReviewOutcome[], run: ReviewOutcome[]) => void;
  onSkipped: (ids: string[]) => void; onClose: () => void;
}) => createElement("div", { "data-run-size": rows.length },
  createElement("button", { onClick: () => onCommitted([reviewOutcome()], [reviewOutcome()]) }, "Commit first shown"),
  createElement("button", { onClick: () => onSkipped([rows[1].id]) }, "Skip refused shown"),
  createElement("button", { onClick: onClose }, "Close group")) }));
import { ReviewAllDialog } from "@/components/ebooks/review-all-dialog";
let root: Root; let host: HTMLElement;
const callbacks = { onClose: vi.fn(), onCommitted: vi.fn(), onUndone: vi.fn(), onRefused: vi.fn() };
const secondId = "66666666-6666-4666-8666-666666666666";
const source = { section: "not_in_durtal" as const, filters: { author: workId }, authorName: "André Breton" };
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(async () => {
  vi.resetAllMocks(); api.readReviewSelectionPageUi.mockResolvedValueOnce({ ok: true, value: { rows: [reviewRow(), { ...reviewRow(), id: secondId, title: "Second book" }], count: 6000, nextCursor: secondId } });
  api.readReviewSelectionPageUi.mockResolvedValue({ ok: true, value: { rows: [], count: 5998, nextCursor: null } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(ReviewAllDialog, { source, action: "keep", ...callbacks })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
function hasButton(label: string) { return [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label); }
async function click(label: string) { await act(async () => { const found = hasButton(label); if (!found) throw new Error(`Missing ${label}`); found.click(); }); }
describe("bounded full-filter review orchestration", () => {
  it("shows descriptors before opening preparation, freezes the page run and requires explicit skip/next-page reads", async () => {
    expect(api.readReviewSelectionPageUi).not.toHaveBeenCalled(); await click("Load next 50 filtered eBooks");
    expect(host.querySelector('[aria-label="Next filtered eBooks"]')?.textContent).toContain("Nadja");
    expect(callbacks.onCommitted).not.toHaveBeenCalled(); await click("Review these 2 eBooks"); await click("Commit first shown");
    expect(host.querySelector("[data-run-size]")?.getAttribute("data-run-size")).toBe("2");
    await click("Close group"); expect(hasButton("Load next 50 filtered eBooks")).toBeUndefined();
    expect(hasButton("Review these 1 eBooks")).toBeDefined();
    // Reopen with the remaining real descriptor; source test bridge skips it.
    await click("Review these 1 eBooks"); await click("Close group");
    expect(api.readReviewSelectionPageUi).toHaveBeenCalledOnce();
    expect(callbacks.onCommitted.mock.calls[0][2].map((row: ReviewQueueRow) => row.id)).toEqual([ebookId, secondId]);
  });
  it("advances only after the current page commits or is explicitly skipped, retaining scope and cursor", async () => {
    await click("Load next 50 filtered eBooks"); await click("Review these 2 eBooks");
    await click("Commit first shown"); await click("Skip refused shown"); await click("Close group");
    expect(host.textContent).toContain("1 committed · 1 explicitly skipped");
    expect(api.readReviewSelectionPageUi).toHaveBeenCalledOnce(); await click("Load next 50 filtered eBooks");
    expect(api.readReviewSelectionPageUi.mock.calls).toEqual([[{ ...source, cursor: null }], [{ ...source, cursor: secondId }]]);
    expect(host.textContent).toContain("last page"); expect(callbacks.onCommitted).toHaveBeenCalledOnce();
  });
});
