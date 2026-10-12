// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseReviewParams } from "@/lib/ebooks/review-queue/params";
import { REVIEW_SECTIONS, type ReviewQueue } from "@/lib/ebooks/review-queue/types";
import { ebookId, stamp, operation, preparedReview, reviewOutcome, reviewRow } from "../ebooks/review-ui-fixtures";
const api = vi.hoisted(() => ({ prepareReviewUi: vi.fn(), confirmReviewUi: vi.fn(), readReviewUi: vi.fn(), undoReviewUi: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-ui", () => api);
vi.mock("@/lib/actions/ebook-review-selection-ui", () => ({ prepareReviewSelectionUi: vi.fn(), prepareAcceptReviewSelectionUi: vi.fn(), confirmReviewSelectionUi: vi.fn(), undoReviewSelectionUi: vi.fn() }));
vi.mock("@/lib/actions/work-review-ui", () => ({ prepareWorkReviewUi: vi.fn(), confirmWorkReviewUi: vi.fn(), undoWorkReviewUi: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-pages-ui", () => ({ readReviewSelectionPageUi: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-unlink-ui", () => ({ prepareReviewUnlinkUi: vi.fn(), confirmReviewUnlinkUi: vi.fn(), readReviewUnlinkTargetUi: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: api.refresh }) }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: ({ children }: { children: ReactNode }) => createElement("div", { role: "dialog" }, children) }));
vi.mock("@/components/ebooks/choose-book-dialog", () => ({ ChooseBookFields: () => null }));
vi.mock("@/components/ebooks/new-book-dialog", () => ({ NewBookFields: () => null }));
import { ReviewView } from "@/app/(catalogue)/ebooks/review/review-view";
let root: Root; let host: HTMLElement;
const secondId = "66666666-6666-4666-8666-666666666666";
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(async () => {
  vi.resetAllMocks(); api.prepareReviewUi.mockImplementation(async ({ intent }: { intent: { ebookId: string } }) =>
    ({ ok: true, value: { ...preparedReview(), request: { ...preparedReview().request, ebookId: intent.ebookId } } }));
  api.confirmReviewUi.mockResolvedValue({ ok: true, value: reviewOutcome() });
  api.readReviewUi.mockResolvedValue({ ok: false, error: { code: "unavailable", message: "Focused preview unavailable", retryOriginal: false } });
  api.undoReviewUi.mockResolvedValueOnce({ ok: false, error: { code: "outcome_unknown_retry_original", message: "Retry the original Undo", retryOriginal: true } });
  api.undoReviewUi.mockResolvedValueOnce({ ok: false, error: { code: "stale_review", message: "A later change refused Undo", retryOriginal: false } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const counts = Object.fromEntries(REVIEW_SECTIONS.map(({ key }) => [key, key === "not_in_durtal" ? 2 : 0])) as ReviewQueue["counts"];
  await act(async () => root.render(createElement(ReviewView, { params: parseReviewParams({}), queue: { counts,
    sections: [{ key: "not_in_durtal", rows: [reviewRow(), { ...reviewRow(), id: secondId, title: "Second book" }] }] } })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function click(label: string) {
  await act(async () => { const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label);
    if (!found) throw new Error(`Missing ${label}`); found.click(); });
}
describe("single Undo uncertainty recovery", () => {
  it("clears only uncertainty after a definite retry refusal, preserving the receipt/error and unlocking another decision", async () => {
    await click("Keep as eBook"); await click("Confirm decision"); await click("Undo");
    await click("Keep as eBook"); expect(host.querySelector('[role="dialog"]')).toBeNull();
    await click("Retry this Undo");
    expect(api.undoReviewUi.mock.calls).toEqual([[{ ebookId, originalOperation: operation }], [{ ebookId, originalOperation: operation }]]);
    expect(host.textContent).toContain("A later change refused Undo");
    const recent = host.querySelector('[aria-label="Recent decisions"]');
    expect(recent?.textContent).toContain("Nadja"); expect(recent?.querySelector("button")?.textContent).toBe("Undo");
    expect(api.refresh).toHaveBeenCalledOnce();
    await click("Keep as eBook"); expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(api.prepareReviewUi).toHaveBeenLastCalledWith({ intent: { action: "keep", ebookId: secondId }, stamp });
  });
});
