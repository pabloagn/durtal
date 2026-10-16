// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { InstanceDraft } from "@/components/books/instance-form";
import { preparedReview, reviewOutcome, reviewRow, workId, ebookId, stamp } from "../ebooks/review-ui-fixtures";

const api = vi.hoisted(() => ({ createInstance: vi.fn(), prepareReviewUi: vi.fn(), confirmReviewUi: vi.fn(), refresh: vi.fn(), notifyReviewOutcome: vi.fn() }));
const editionId = "66666666-6666-4666-8666-666666666666";
const locationId = "99999999-9999-4999-8999-999999999999";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: api.refresh }) }));
vi.mock("@/lib/actions/instances", () => ({ createInstance: api.createInstance }));
vi.mock("@/lib/actions/ebook-review-ui", () => ({ prepareReviewUi: api.prepareReviewUi, confirmReviewUi: api.confirmReviewUi }));
vi.mock("@/lib/ebooks/review-queue/feedback", () => ({ notifyReviewOutcome: api.notifyReviewOutcome }));
vi.mock("@/lib/notifications/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/activity/refresh-event", () => ({ triggerActivityRefresh: vi.fn() }));
vi.mock("@/lib/hooks/use-app-settings", () => ({ useAppSettings: () => ({ newCopyLocationId: "99999999-9999-4999-8999-999999999999", newCopyFormat: "ebook", newCopyCondition: "mint" }) }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: ({ open, children, onClose }: { open: boolean; children: ReactNode; onClose: () => void }) =>
  open ? createElement("div", { role: "dialog", "aria-modal": "true" }, children, createElement("button", { onClick: onClose }, "Close dialog")) : null,
  DialogFooter: ({ children }: { children: ReactNode }) => createElement("div", null, children) }));
vi.mock("@/components/ebooks/ebook-picker", () => ({ EbookPicker: ({ onChange, disabled }: { onChange: (value: ReturnType<typeof reviewRow>) => void; disabled: boolean }) =>
  createElement("button", { disabled, onClick: () => onChange(reviewRow()) }, "Choose Nadja eBook") }));
vi.mock("@/components/books/instance-form", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/books/instance-form")>(),
  InstanceForm: ({ ebookField, value, onChange }: { ebookField: ReactNode; value: InstanceDraft; onChange: (value: InstanceDraft) => void }) =>
    createElement("div", null, ebookField, createElement("button", { onClick: () => onChange({ ...value, notes: "Personal copy", fileSizeBytes: "99999" }) }, "Add notes")),
}));
import { InstanceAddDialog } from "@/app/(catalogue)/library/[slug]/instance-add-dialog";

let host: HTMLElement; let root: Root;
function preview() { const base = preparedReview(); return { ...base, request: { ...base.request,
  action: "link" as const, workId, choice: { kind: "add_copy" as const, editionId } } }; }
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(async () => {
  vi.resetAllMocks(); api.prepareReviewUi.mockResolvedValue({ ok: true, value: preview() });
  api.confirmReviewUi.mockResolvedValue({ ok: true, value: reviewOutcome() });
  api.createInstance.mockResolvedValue({ id: "copy" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(InstanceAddDialog, { workId, editionId, editionTitle: "Nadja",
    availableLocations: [{ id: locationId, name: "eBooks", type: "digital", isActive: true, subLocations: [] }] })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function click(text: string) { await act(async () => { const button = [...host.querySelectorAll<HTMLButtonElement>("button")]
  .find((item) => item.textContent?.includes(text)); if (!button) throw new Error(`Missing ${text}`); button.click(); }); }
describe("copy creation through the actual review delegate", () => {
  it("never creates a copy before linking a selected eBook; descriptive metadata is in the single prepare intent", async () => {
    await click("Add instance"); await click("Add notes"); await click("Choose Nadja eBook"); await click("Preview copy and eBook");
    expect(api.createInstance).not.toHaveBeenCalled(); expect(api.confirmReviewUi).not.toHaveBeenCalled();
    expect(api.prepareReviewUi).toHaveBeenCalledWith({ stamp, intent: {
      action: "link", ebookId, workId, choice: { kind: "add_copy", editionId }, locationId,
      newCopyDraft: expect.objectContaining({ notes: "Personal copy", condition: "mint" }),
    } });
    const draft = api.prepareReviewUi.mock.calls[0][0].intent.newCopyDraft;
    for (const key of ["format", "status", "fileSizeBytes", "editionId", "locationId"]) expect(draft).not.toHaveProperty(key);
    await click("Confirm decision");
    expect(api.confirmReviewUi).toHaveBeenCalledWith({ request: preview().request, previewToken: preview().previewToken });
    expect(api.createInstance).not.toHaveBeenCalled(); expect(api.refresh).toHaveBeenCalledOnce();
  });
  it("keeps the selected copy operation intact after an uncertain write", async () => {
    api.confirmReviewUi.mockResolvedValueOnce({ ok: false, error: { code: "outcome_unknown_retry_original", message: "Retry", retryOriginal: true } });
    await click("Add instance"); await click("Choose Nadja eBook"); await click("Preview copy and eBook"); await click("Confirm decision");
    await click("Close dialog"); expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    await click("Retry this decision");
    expect(api.prepareReviewUi).toHaveBeenCalledOnce(); expect(api.createInstance).not.toHaveBeenCalled();
    expect(api.confirmReviewUi.mock.calls[0]).toEqual(api.confirmReviewUi.mock.calls[1]);
  });
  it("retains ordinary instance creation when no eBook was selected", async () => {
    await click("Add instance"); await click("Create instance");
    expect(api.createInstance).toHaveBeenCalledWith(expect.objectContaining({ editionId, locationId, format: "ebook" }));
    expect(api.prepareReviewUi).not.toHaveBeenCalled(); expect(api.confirmReviewUi).not.toHaveBeenCalled();
  });
});
