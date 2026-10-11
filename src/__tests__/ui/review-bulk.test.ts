// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PreparedReviewSelection } from "@/lib/ebooks/review/bulk";
import { ebookId, stamp, preparedReview, reviewOutcome, reviewRow, operation } from "../ebooks/review-ui-fixtures";

const api = vi.hoisted(() => ({ prepareReviewSelectionUi: vi.fn(), prepareAcceptReviewSelectionUi: vi.fn(),
  confirmReviewSelectionUi: vi.fn(), undoReviewSelectionUi: vi.fn() }));
vi.mock("@/lib/actions/ebook-review-selection-ui", () => api);
vi.mock("@/components/ui/dialog", () => ({ Dialog: ({ children, onClose }: { children: ReactNode; onClose: () => void }) =>
  createElement("div", { role: "dialog" }, children, createElement("button", { onClick: onClose }, "Close dialog")) }));
vi.mock("@/components/ebooks/new-book-dialog", () => ({ NewBookFields: ({ row, onPrepare }: {
  row: { id: string; language: string | null }; onPrepare: (value: unknown) => void;
}) => createElement("button", { "data-group-language": row.language ?? "", onClick: () => onPrepare({
  action: "accession", ebookId: row.id, authors: [{ name: "André Breton" }], language: "fr", isbn13: null,
}) }, "Choose group author and language") }));
import { ReviewBulkDialog } from "@/components/ebooks/review-bulk-dialog";
import { ReviewBulkUndo } from "@/components/ebooks/review-bulk-undo";

const secondId = "66666666-6666-4666-8666-666666666666";
const secondOperation = { ...operation, operationId: "77777777-7777-4777-8777-777777777777" };
const rows = () => [reviewRow(), { ...reviewRow(), id: secondId, title: "L'Amour fou" }];
function prefix(): PreparedReviewSelection {
  return { requests: [preparedReview().request], previewToken: preparedReview().previewToken, preparedCount: 1,
    selectionCount: 2, rows: [{ ebookId, text: "Only Nadja is prepared", format: null, fileSizeBytes: null, locationId: null, canUndo: true }],
    deferredIntents: [{ action: "keep", ebookId: secondId }] };
}
let root: Root; let host: HTMLElement;
const callbacks = { onClose: vi.fn(), onCommitted: vi.fn(), onUndone: vi.fn(), onRefused: vi.fn() };
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  vi.resetAllMocks(); api.prepareReviewSelectionUi.mockResolvedValue({ ok: true, value: prefix() });
  api.confirmReviewSelectionUi.mockResolvedValue({ ok: true, value: { outcomes: [reviewOutcome()] } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}`); return found;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function render(action: "keep" | "accession" = "keep") {
  await act(async () => root.render(createElement(ReviewBulkDialog, { rows: rows(), action, ...callbacks })));
}
describe("actual bounded bulk dialog", () => {
  it("confirms only the returned prefix, then waits for a fresh visible preview of deferred rows", async () => {
    await render(); await click("Preview next group");
    expect(api.confirmReviewSelectionUi).not.toHaveBeenCalled();
    expect(host.textContent).toContain("This confirmation covers 1 eBook");
    expect(host.textContent).toContain("1 remain deferred");
    await click("Confirm 1 decision");
    expect(api.confirmReviewSelectionUi).toHaveBeenCalledWith({ requests: prefix().requests, previewToken: prefix().previewToken });
    expect(callbacks.onCommitted).toHaveBeenCalledWith([reviewOutcome()], [reviewOutcome()]);
    expect(api.prepareReviewSelectionUi).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("1 of 2 decided · 1 waiting");
    await click("Preview next group");
    expect(api.prepareReviewSelectionUi.mock.calls[1]).toEqual([{ intents: prefix().deferredIntents,
      stamps: [{ ebookId: secondId, stamp }] }]);
    expect(api.confirmReviewSelectionUi).toHaveBeenCalledOnce();
  });
  it("locks close and preserves the exact capability after an unknown confirmation", async () => {
    api.confirmReviewSelectionUi.mockResolvedValueOnce({ ok: false, error: { code: "outcome_unknown_retry_original", message: "Try the original group", retryOriginal: true } });
    await render(); await click("Preview next group"); await click("Confirm 1 decision");
    await click("Close dialog"); expect(callbacks.onClose).not.toHaveBeenCalled();
    expect(button("Stop here").disabled).toBe(true); expect(callbacks.onCommitted).not.toHaveBeenCalled();
    await click("Retry this same group");
    const input = { requests: prefix().requests, previewToken: prefix().previewToken };
    expect(api.confirmReviewSelectionUi.mock.calls).toEqual([[input], [input]]);
    expect(api.prepareReviewSelectionUi).toHaveBeenCalledOnce();
  });
  it("retains refused rows until an explicit skip and ignores cancelled preparation", async () => {
    api.prepareReviewSelectionUi.mockResolvedValueOnce({ ok: false, error: { code: "stale_review", message: "Changed row", retryOriginal: false, ebookIds: [secondId] } });
    await render(); await click("Preview next group");
    expect(callbacks.onRefused).toHaveBeenCalledWith([secondId], "Changed row");
    expect(callbacks.onCommitted).not.toHaveBeenCalled();
    expect(host.textContent).toContain("2 waiting");
    await click("Skip these 1 refused eBooks"); expect(host.textContent).toContain("1 waiting · 1 refused");
    let resolve!: (value: unknown) => void;
    api.prepareReviewSelectionUi.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await click("Preview next group"); await click("Stop here");
    expect(callbacks.onClose).toHaveBeenCalledOnce();
    await act(async () => resolve({ ok: true, value: prefix() }));
    expect(host.textContent).not.toContain("This confirmation covers"); expect(api.confirmReviewSelectionUi).not.toHaveBeenCalled();
  });
  it("uses explicit shared author/language choices and displays the actual accession counts", async () => {
    const selected = rows(); selected[1] = { ...selected[1], language: "en" };
    api.prepareReviewSelectionUi.mockResolvedValue({ ok: true, value: { ...prefix(), preparedCount: 2,
      requests: selected.map((row, index) => ({ ...preparedReview().request, action: "accession", ebookId: row.id,
        operation: index ? secondOperation : operation, authors: [{ name: "André Breton" }], language: "fr", isbn13: null })),
      rows: selected.map((row) => ({ ...prefix().rows[0], ebookId: row.id })), deferredIntents: [],
      accessionCounts: { books: 2, editions: 2, copies: 2, newAuthors: 1, newSeries: 0 } } });
    await act(async () => root.render(createElement(ReviewBulkDialog, { rows: selected, action: "accession", ...callbacks })));
    expect(button("Choose group author and language").dataset.groupLanguage).toBe("");
    await click("Choose group author and language");
    expect(api.prepareReviewSelectionUi).toHaveBeenCalledWith({ intents: selected.map((row) => ({ action: "accession", ebookId: row.id,
      authors: [{ name: "André Breton" }], language: "fr", isbn13: null })), stamps: selected.map((row) => ({ ebookId: row.id, stamp })) });
    expect(host.textContent).toContain("2 books · 2 editions · 2 copies · 1 new authors · 0 new series");
    expect(api.confirmReviewSelectionUi).not.toHaveBeenCalled();
  });
});
describe("receipt-backed stopped bulk Undo", () => {
  it("keeps completed, uncertain and deferred progress, retrying the unchanged original set", async () => {
    const thirdId = "88888888-8888-4888-8888-888888888888";
    const thirdOperation = { ...operation, operationId: "99999999-9999-4999-8999-999999999999" };
    const outcomes = [reviewOutcome(), { ...reviewOutcome(), ebookId: secondId, operation: secondOperation, undo: { available: true, originalOperation: secondOperation } },
      { ...reviewOutcome(), ebookId: thirdId, operation: thirdOperation, undo: { available: true, originalOperation: thirdOperation } }];
    const requests = outcomes.map((row) => ({ ebookId: row.ebookId, originalOperation: row.undo.originalOperation }));
    api.undoReviewSelectionUi.mockResolvedValueOnce({ ok: true, value: { rows: [{ status: "committed", outcome: reviewOutcome() },
      { status: "unconfirmed", ...requests[1], code: "invalid_receipt", message: "Outcome unconfirmed" }], deferredRequests: [requests[2]], stopped: true } });
    api.undoReviewSelectionUi.mockResolvedValueOnce({ ok: true, value: { rows: outcomes.map((outcome) => ({ status: "committed", outcome })), deferredRequests: [], stopped: false } });
    const onBusy = vi.fn();
    await act(async () => root.render(createElement(ReviewBulkUndo, { outcomes, onBusy, onUndone: callbacks.onUndone })));
    await click("Undo all 3");
    expect(callbacks.onUndone).toHaveBeenCalledWith([reviewOutcome()], outcomes);
    expect(onBusy).toHaveBeenLastCalledWith(true); expect(host.textContent).toContain("1 undone · Outcome unconfirmed · 1 still waiting");
    await click("Retry this Undo set");
    expect(api.undoReviewSelectionUi.mock.calls).toEqual([[{ requests }], [{ requests }]]);
    expect(onBusy).toHaveBeenLastCalledWith(false); expect(button("Undone").disabled).toBe(true);
  });
});
