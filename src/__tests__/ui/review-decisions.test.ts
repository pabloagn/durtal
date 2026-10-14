// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseReviewParams } from "@/lib/ebooks/review-queue/params";
import { REVIEW_SECTIONS, type ReviewQueue } from "@/lib/ebooks/review-queue/types";
import { ebookId, operation, preparedReview, reviewDetail, reviewOutcome, reviewRow } from "../ebooks/review-ui-fixtures";

const api = vi.hoisted(() => ({ prepareReviewUi: vi.fn(), confirmReviewUi: vi.fn(), readReviewUi: vi.fn(), undoReviewUi: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-ui", () => api);
vi.mock("@/lib/actions/ebook-review-selection-ui", () => ({ prepareReviewSelectionUi: vi.fn(),
  prepareAcceptReviewSelectionUi: vi.fn(), confirmReviewSelectionUi: vi.fn(), undoReviewSelectionUi: vi.fn() }));
vi.mock("@/lib/actions/work-review-ui", () => ({ prepareWorkReviewUi: vi.fn(), confirmWorkReviewUi: vi.fn(), undoWorkReviewUi: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-pages-ui", () => ({ readReviewSelectionPageUi: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-unlink-ui", () => ({ prepareReviewUnlinkUi: vi.fn(), confirmReviewUnlinkUi: vi.fn(), readReviewUnlinkTargetUi: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: api.refresh }) }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: ({ children, title, onClose }: { children: ReactNode; title: string; onClose: () => void }) =>
  createElement("div", { role: "dialog", "aria-modal": "true" }, createElement("h2", null, title), children,
    createElement("button", { onClick: onClose }, "Close dialog")) }));
vi.mock("@/components/ebooks/choose-book-dialog", () => ({ ChooseBookFields: () => null }));
vi.mock("@/components/ebooks/new-book-dialog", () => ({ NewBookFields: () => null }));
import { ReviewView } from "@/app/(catalogue)/ebooks/review/review-view";

let root: Root; let host: HTMLElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(async () => {
  vi.resetAllMocks();
  api.prepareReviewUi.mockResolvedValue({ ok: true, value: preparedReview() });
  api.readReviewUi.mockResolvedValue({ ok: true, value: reviewDetail() });
  api.confirmReviewUi.mockResolvedValue({ ok: true, value: reviewOutcome() });
  api.undoReviewUi.mockResolvedValue({ ok: true, value: { ...reviewOutcome(), message: "Returned to review.", keptCopy: true, undo: { available: false, originalOperation: null } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const counts = Object.fromEntries(REVIEW_SECTIONS.map(({ key }) => [key, key === "not_in_durtal" ? 1 : 0])) as ReviewQueue["counts"];
  await act(async () => root.render(createElement(ReviewView, { queue: { counts, sections: [{ key: "not_in_durtal", rows: [reviewRow()] }], page: 1 }, params: parseReviewParams({}) })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}`); return found;
}
async function click(label: string) { await act(async () => button(label).click()); }
describe("real review view confirmation flow", () => {
  it("shows the prepared effect, awaits confirmation and uses the exact original receipt for Undo", async () => {
    await click("Keep as eBook");
    expect(api.prepareReviewUi).toHaveBeenCalledWith({ intent: { action: "keep", ebookId }, stamp: reviewRow().stamp });
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Kept as a standalone eBook.");
    expect(api.confirmReviewUi).not.toHaveBeenCalled();
    await click("Confirm decision");
    expect(api.confirmReviewUi).toHaveBeenCalledWith({ request: preparedReview().request, previewToken: preparedReview().previewToken });
    expect(host.querySelector("[data-review-row]")).toBeNull();
    expect(api.refresh).toHaveBeenCalledOnce();
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "Undo")!.click());
    expect(api.undoReviewUi).toHaveBeenCalledWith({ ebookId, originalOperation: operation });
    expect(host.querySelector("[aria-live]")?.textContent).toBe("Returned to review.");
  });
  it("keeps a row and exact capability on unknown outcome; retry never replans", async () => {
    api.confirmReviewUi.mockResolvedValueOnce({ ok: false, error: { code: "outcome_unknown_retry_original", message: "Retry this decision", retryOriginal: true } });
    await click("Keep as eBook"); await click("Confirm decision");
    expect(host.querySelector("[data-review-row]")).not.toBeNull();
    expect(api.refresh).not.toHaveBeenCalled();
    await click("Close dialog"); expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await click("Retry this decision");
    expect(api.prepareReviewUi).toHaveBeenCalledOnce();
    expect(api.confirmReviewUi.mock.calls).toEqual([
      [{ request: preparedReview().request, previewToken: preparedReview().previewToken }],
      [{ request: preparedReview().request, previewToken: preparedReview().previewToken }],
    ]);
  });
  it("rejects stale/expired confirmation without removing the row or clearing selection", async () => {
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    api.confirmReviewUi.mockResolvedValueOnce({ ok: false, error: { code: "preview_expired", message: "Prepare a new visible preview", retryOriginal: false } });
    await click("Keep as eBook"); await click("Confirm decision");
    expect(host.querySelector("[data-review-row]")).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    expect(host.textContent).toContain("Prepare a new visible preview");
    expect([...host.querySelectorAll("button")].some((item) => item.textContent === "Confirm decision")).toBe(false);
  });
  it("does not apply or reopen a dialog when a cancelled preparation returns late", async () => {
    let resolve!: (value: unknown) => void;
    api.prepareReviewUi.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await click("Keep as eBook"); await click("Cancel");
    await act(async () => resolve({ ok: true, value: preparedReview() }));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(api.confirmReviewUi).not.toHaveBeenCalled();
    expect(host.querySelector("[data-review-row]")).not.toBeNull();
  });
  it("prevents a second apply or cancellation while the first confirmation is in flight", async () => {
    let resolve!: (value: unknown) => void;
    api.confirmReviewUi.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await click("Keep as eBook"); await click("Confirm decision"); await click("Close dialog");
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(button("Confirming…").disabled).toBe(true);
    expect(api.confirmReviewUi).toHaveBeenCalledOnce();
    await act(async () => resolve({ ok: true, value: reviewOutcome() }));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});
