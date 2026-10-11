// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseReviewParams } from "@/lib/ebooks/review-queue/params";
import { REVIEW_SECTIONS, type ReviewQueue } from "@/lib/ebooks/review-queue/types";
import { ebookId, operation, preparedReview, reviewOutcome, reviewRow } from "../ebooks/review-ui-fixtures";
const api = vi.hoisted(() => ({ prepareReviewSelectionUi: vi.fn(), prepareAcceptReviewSelectionUi: vi.fn(), confirmReviewSelectionUi: vi.fn(),
  undoReviewSelectionUi: vi.fn(), prepareReviewUi: vi.fn(), readReviewUi: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-selection-ui", () => api);
vi.mock("@/lib/actions/ebook-review-ui", () => ({ prepareReviewUi: api.prepareReviewUi, readReviewUi: api.readReviewUi,
  confirmReviewUi: vi.fn(), undoReviewUi: vi.fn() }));
vi.mock("@/lib/actions/work-review-ui", () => ({ prepareWorkReviewUi: vi.fn(), confirmWorkReviewUi: vi.fn(), undoWorkReviewUi: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-pages-ui", () => ({ readReviewSelectionPageUi: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-unlink-ui", () => ({ prepareReviewUnlinkUi: vi.fn(), confirmReviewUnlinkUi: vi.fn(), readReviewUnlinkTargetUi: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: api.refresh }) }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: ({ children }: { children: ReactNode }) => createElement("div", { role: "dialog" }, children) }));
vi.mock("@/components/ebooks/new-book-dialog", () => ({ NewBookFields: () => null }));
vi.mock("@/components/ebooks/choose-book-dialog", () => ({ ChooseBookFields: () => null }));
import { ReviewView } from "@/app/(catalogue)/ebooks/review/review-view";
let root: Root; let host: HTMLElement;
const secondId = "66666666-6666-4666-8666-666666666666";
const secondOperation = { ...operation, operationId: "77777777-7777-4777-8777-777777777777" };
const secondOutcome = { ...reviewOutcome(), ebookId: secondId, operation: secondOperation, undo: { available: true, originalOperation: secondOperation } };
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(async () => {
  vi.resetAllMocks(); api.readReviewUi.mockResolvedValue({ ok: false, error: { code: "unavailable", message: "Unavailable", retryOriginal: false } });
  api.prepareReviewSelectionUi.mockResolvedValueOnce({ ok: true, value: { requests: [preparedReview().request], previewToken: "d".repeat(64),
    rows: [{ ebookId, text: "Keep first only", format: null, fileSizeBytes: null, locationId: null, canUndo: true }],
    preparedCount: 1, selectionCount: 2, deferredIntents: [{ action: "keep", ebookId: secondId }] } });
  api.prepareReviewSelectionUi.mockResolvedValueOnce({ ok: true, value: { requests: [{ ...preparedReview().request, ebookId: secondId, operation: secondOperation }], previewToken: "e".repeat(64),
    rows: [{ ebookId: secondId, text: "Keep deferred second", format: null, fileSizeBytes: null, locationId: null, canUndo: true }],
    preparedCount: 1, selectionCount: 1, deferredIntents: [] } });
  api.confirmReviewSelectionUi.mockResolvedValueOnce({ ok: false, error: { code: "outcome_unknown_retry_original", message: "Retry original", retryOriginal: true } });
  api.confirmReviewSelectionUi.mockResolvedValueOnce({ ok: true, value: { outcomes: [reviewOutcome()] } });
  api.confirmReviewSelectionUi.mockResolvedValueOnce({ ok: true, value: { outcomes: [secondOutcome] } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const counts = Object.fromEntries(REVIEW_SECTIONS.map(({ key }) => [key, key === "not_in_durtal" ? 2 : 0])) as ReviewQueue["counts"];
  await act(async () => root.render(createElement(ReviewView, { params: parseReviewParams({}), queue: { counts,
    sections: [{ key: "not_in_durtal", rows: [reviewRow(), { ...reviewRow(), id: secondId, title: "Second book" }] }] } })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function click(label: string) { await act(async () => {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing ${label}`); found.click();
}); }
describe("mounted real selection, prefix confirmation and Undo", () => {
  it("removes only committed rows, preserves deferred selection and reuses the complete original Undo set", async () => {
    await click("Select shown"); await click("Keep selected…"); await click("Preview next group"); await click("Confirm 1 decision");
    expect(host.querySelectorAll("[data-review-row]")).toHaveLength(2);
    expect([...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((input) => input.checked)).toBe(true);
    await click("Keep as eBook"); expect(api.prepareReviewUi).not.toHaveBeenCalled();
    await click("Retry this same group"); expect(api.confirmReviewSelectionUi.mock.calls[0]).toEqual(api.confirmReviewSelectionUi.mock.calls[1]);
    expect(host.querySelectorAll("[data-review-row]")).toHaveLength(1);
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(true);
    expect(api.prepareReviewSelectionUi).toHaveBeenCalledOnce(); await click("Preview next group"); await click("Confirm 1 decision");
    expect(host.querySelectorAll("[data-review-row]")).toHaveLength(0);
    const requests = [{ ebookId, originalOperation: operation }, { ebookId: secondId, originalOperation: secondOperation }];
    api.undoReviewSelectionUi.mockResolvedValueOnce({ ok: true, value: { stopped: true, rows: [{ status: "unconfirmed", ...requests[0],
      code: "invalid_receipt", message: "Check original Undo" }], deferredRequests: [requests[1]] } });
    api.undoReviewSelectionUi.mockResolvedValueOnce({ ok: true, value: { stopped: false,
      rows: [reviewOutcome(), secondOutcome].map((outcome) => ({ status: "committed", outcome })), deferredRequests: [] } });
    // The actual bulk dialog's Undo remains mounted alongside recent run receipts.
    const undoButtons = [...host.querySelectorAll<HTMLButtonElement>("button")].filter((item) => item.textContent === "Undo all 2");
    await act(async () => undoButtons.at(-1)!.click());
    expect(host.querySelectorAll("[data-review-row]")).toHaveLength(0); await click("Close");
    expect(host.querySelector('[role="dialog"]')).not.toBeNull(); await click("Retry this Undo set");
    expect(api.undoReviewSelectionUi.mock.calls).toEqual([[{ requests }], [{ requests }]]);
    expect(host.querySelectorAll("[data-review-row]")).toHaveLength(2);
  });
});
