// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { preparedWork, workOutcome } from "../ebooks/work-review-ui-fixtures";
import { workId, operation } from "../ebooks/review-ui-fixtures";
const api = vi.hoisted(() => ({ prepareWorkReviewUi: vi.fn(), confirmWorkReviewUi: vi.fn(), undoWorkReviewUi: vi.fn() }));
vi.mock("@/lib/actions/work-review-ui", () => api);
vi.mock("@/components/ui/dialog", () => ({ Dialog: ({ children, onClose }: { children: ReactNode; onClose: () => void }) =>
  createElement("div", { role: "dialog" }, children, createElement("button", { onClick: onClose }, "Dismiss")) }));
import { WorkReviewDialog } from "@/components/ebooks/work-review-dialog";
let root: Root; let host: HTMLElement;
const callbacks = { onClose: vi.fn(), onCommitted: vi.fn(), onUndone: vi.fn() };
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(async () => {
  vi.resetAllMocks(); api.prepareWorkReviewUi.mockResolvedValue({ ok: true, value: preparedWork() });
  api.confirmWorkReviewUi.mockResolvedValue({ ok: true, value: workOutcome() });
  api.undoWorkReviewUi.mockResolvedValue({ ok: true, value: { ...workOutcome(), catalogueStatus: "wanted", undo: { available: false, originalOperation: null } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(WorkReviewDialog, { work: { id: workId, title: "Nadja", status: "wanted" }, ...callbacks })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button ${label}`); return found;
}
async function click(label: string) { await act(async () => button(label).click()); }
describe("guarded status/history UI", () => {
  it("makes each step's next action the main one, so Enter and ⌘Enter press it", async () => {
    expect(button("Preview accessioned status").dataset.variant).toBe("primary");
    await click("Preview accessioned status"); expect(button("Confirm status change").dataset.variant).toBe("primary");
  });
  it("shows the exact transition before writing and binds Undo to the receipt", async () => {
    await click("Preview accessioned status"); expect(host.textContent).toContain("wanted → accessioned");
    expect(api.confirmWorkReviewUi).not.toHaveBeenCalled(); await click("Confirm status change");
    expect(api.confirmWorkReviewUi).toHaveBeenCalledWith({ request: preparedWork().request, previewToken: preparedWork().previewToken });
    expect(callbacks.onCommitted).toHaveBeenCalledWith(workOutcome()); await click("Undo status change");
    expect(api.undoWorkReviewUi).toHaveBeenCalledWith({ workId, originalOperation: operation });
    expect(callbacks.onUndone).toHaveBeenCalledOnce();
  });
  it("locks dismissal on uncertainty and retries the exact status operation without preparing", async () => {
    api.confirmWorkReviewUi.mockResolvedValueOnce({ ok: false, error: { retryOriginal: true, message: "Unknown" } });
    await click("Preview accessioned status"); await click("Confirm status change"); await click("Dismiss");
    expect(callbacks.onClose).not.toHaveBeenCalled(); await click("Retry this status decision");
    const input = { request: preparedWork().request, previewToken: preparedWork().previewToken };
    expect(api.confirmWorkReviewUi.mock.calls).toEqual([[input], [input]]); expect(api.prepareWorkReviewUi).toHaveBeenCalledOnce();
  });
  it("preserves the original operation on uncertain Undo and reports later-change refusal without claiming success", async () => {
    api.undoWorkReviewUi.mockResolvedValueOnce({ ok: false, error: { retryOriginal: true, message: "Retry original Undo" } });
    api.undoWorkReviewUi.mockResolvedValueOnce({ ok: false, error: { retryOriginal: false, code: "stale_review", message: "Later holding/history change" } });
    await click("Preview accessioned status"); await click("Confirm status change"); await click("Undo status change");
    await click("Dismiss"); expect(callbacks.onClose).not.toHaveBeenCalled(); await click("Retry this status Undo");
    expect(api.undoWorkReviewUi.mock.calls).toEqual([[{ workId, originalOperation: operation }], [{ workId, originalOperation: operation }]]);
    expect(callbacks.onUndone).not.toHaveBeenCalled(); expect(host.textContent).toContain("Later holding/history change");
    await click("Dismiss"); expect(callbacks.onClose).toHaveBeenCalledOnce();
  });
});
