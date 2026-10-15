// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { InstanceDraft } from "@/components/books/instance-form";
import type { Instance, Location, SubLocation } from "@/lib/types/index";
import { copyContext, copyId, editionId, locationId } from "../ebooks/review-existing-copy-fixtures";
import { preparedReview, reviewOutcome, reviewRow, workId, ebookId, stamp } from "../ebooks/review-ui-fixtures";
const api = vi.hoisted(() => ({ readCopy: vi.fn(), readOptions: vi.fn(), prepare: vi.fn(), confirm: vi.fn(), update: vi.fn(), refresh: vi.fn(), notify: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: api.refresh }) }));
vi.mock("@/lib/actions/instances", () => ({ updateInstance: api.update }));
vi.mock("@/lib/actions/ebook-review-copy-ui", () => ({ readReviewExistingCopyUi: api.readCopy }));
vi.mock("@/lib/actions/ebook-review-ui", () => ({ readReviewWorkOptions: api.readOptions, prepareReviewUi: api.prepare, confirmReviewUi: api.confirm }));
vi.mock("@/lib/ebooks/review-queue/feedback", () => ({ notifyReviewOutcome: api.notify }));
vi.mock("@/lib/activity/refresh-event", () => ({ triggerActivityRefresh: vi.fn() }));
vi.mock("@/lib/notifications/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/hooks/use-app-settings", () => ({ useAppSettings: () => ({ newCopyLocationId: locationId }) }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: ({ open, children, onClose }: { open: boolean; children: ReactNode; onClose: () => void }) =>
  open ? createElement("div", { role: "dialog" }, children, createElement("button", { onClick: onClose }, "Close dialog")) : null }));
vi.mock("@/components/ebooks/ebook-picker", () => ({ EbookPicker: ({ value, disabled, onChange }: { value: unknown; disabled: boolean; onChange: (value: ReturnType<typeof reviewRow> | null) => void }) =>
  createElement("button", { disabled, onClick: () => onChange(value ? null : reviewRow()) }, value ? "Clear eBook" : "Choose eBook") }));
vi.mock("@/components/books/instance-form", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/books/instance-form")>(),
  InstanceForm: ({ value, onChange, ebookField }: { value: InstanceDraft; onChange: (value: InstanceDraft) => void; ebookField: ReactNode }) =>
    createElement("div", null, ebookField, createElement("span", { "data-draft-notes": true }, value.notes),
      createElement("button", { onClick: () => onChange({ ...value, notes: "Chosen note" }) }, "Change notes"),
      createElement("button", { onClick: () => onChange({ ...value, subLocationId: copyId }) }, "Change sub-location")),
}));
import { InstanceEditDialog } from "@/app/(catalogue)/library/[slug]/instance-edit-dialog";
let root: Root; let host: HTMLElement;
const instance: Instance & { location: Location; subLocation: SubLocation | null } = {
  id: copyId, editionId, locationId, subLocationId: null, format: "ebook", status: "available", condition: "mint", notes: "Old note",
  hasDustJacket: null, hasSlipcase: null, conditionNotes: null, isSigned: false, signedBy: null, inscription: null,
  isFirstPrinting: false, provenance: null, acquisitionType: null, acquisitionDate: null, acquisitionSource: null,
  acquisitionPrice: null, acquisitionCurrency: null, fileSizeBytes: null, dispositionType: null, dispositionDate: null,
  dispositionTo: null, dispositionPrice: null, dispositionCurrency: null, dispositionNotes: null, lentTo: null, lentDate: null,
  createdAt: new Date("2026-10-11T00:00:00Z"), updatedAt: new Date("2026-10-11T00:00:00Z"),
  location: { id: locationId, name: "eBooks", type: "digital", isActive: true, street: null, city: null, region: null,
    country: null, countryCode: null, postalCode: null, latitude: null, longitude: null, icon: null, color: null,
    sortOrder: 0, createdAt: new Date("2026-10-11T00:00:00Z") }, subLocation: null,
};
function preview() { const base = preparedReview(); return { ...base, request: { ...base.request, action: "link" as const,
  workId, choice: { kind: "fill_copy" as const, editionId, instanceId: copyId }, existingCopyPatch: { notes: "Chosen note" }, expectedCopyStamp: copyContext().stamp } }; }
function options() { return { ok: true, value: { workId, title: "Nadja", editions: [{ id: editionId, copies: [{ id: copyId, canFill: true, stamp: copyContext().stamp }] }] } }; }
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(async () => {
  vi.resetAllMocks(); api.readCopy.mockResolvedValue({ ok: true, value: copyContext() }); api.readOptions.mockResolvedValue(options());
  api.prepare.mockResolvedValue({ ok: true, value: preview() }); api.confirm.mockResolvedValue({ ok: true, value: reviewOutcome() }); api.update.mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(InstanceEditDialog, { instance, editionId, workId, canLinkEbook: true,
    availableLocations: [{ id: locationId, name: "eBooks", type: "digital", subLocations: [] }] })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function click(text: string) { await act(async () => {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text);
  if (!button) throw new Error(`Missing ${text}`); button.click();
}); }
describe("mounted existing copy edit and Link", () => {
  it("prepares and confirms one real guarded decision, locking unknown retries without a standalone update", async () => {
    api.confirm.mockResolvedValueOnce({ ok: false, error: { code: "outcome_unknown_retry_original", retryOriginal: true, message: "Unknown" } });
    await click("Edit"); expect(api.readCopy).toHaveBeenCalledWith({ workId, editionId, instanceId: copyId });
    await click("Change notes"); await click("Choose eBook"); await click("Preview edits and Link");
    expect(api.prepare).toHaveBeenCalledWith({ stamp, intent: { action: "link", ebookId, workId,
      choice: { kind: "fill_copy", editionId, instanceId: copyId }, existingCopyPatch: { notes: "Chosen note" }, expectedCopyStamp: copyContext().stamp } });
    expect(host.textContent).toContain("Notes: Chosen note"); expect(api.update).not.toHaveBeenCalled();
    await click("Confirm decision"); await click("Close dialog"); expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(api.refresh).not.toHaveBeenCalled(); await click("Retry this decision");
    expect(api.confirm.mock.calls[0]).toEqual(api.confirm.mock.calls[1]); expect(api.prepare).toHaveBeenCalledOnce();
    expect(api.update).not.toHaveBeenCalled(); expect(api.notify).toHaveBeenCalledWith(reviewOutcome(), expect.any(Function)); expect(api.refresh).toHaveBeenCalledOnce();
  });
  it("keeps reserved edits visible and blocks preparation until explicitly restored", async () => {
    await click("Edit"); await click("Change notes"); await click("Change sub-location"); await click("Choose eBook"); await click("Preview edits and Link");
    expect(api.prepare).not.toHaveBeenCalled(); expect(host.textContent).toContain("Restore those choices");
    await click("Restore location, status and digital choices"); expect(host.querySelector('[data-draft-notes]')?.textContent).toBe("Chosen note");
    await click("Preview edits and Link"); expect(api.prepare.mock.calls[0][0].intent.existingCopyPatch).toEqual({ notes: "Chosen note" });
  });
  it("refuses newer copy options rather than silently reanchoring the edited draft", async () => {
    const latest = options(); latest.value.editions[0].copies[0].stamp.updatedAt = "2026-10-11T00:00:00.000002Z"; api.readOptions.mockResolvedValue(latest);
    await click("Edit"); await click("Change notes"); await click("Choose eBook"); await click("Preview edits and Link");
    expect(api.prepare).not.toHaveBeenCalled(); expect(host.textContent).toContain("Your edits are kept");
    expect(host.querySelector('[data-draft-notes]')?.textContent).toBe("Chosen note");
  });
  it("performs ordinary Save when no eBook is selected", async () => {
    await click("Edit"); await click("Change notes"); await click("Save");
    expect(api.update).toHaveBeenCalledWith(copyId, expect.objectContaining({ notes: "Chosen note", locationId }));
    expect(api.prepare).not.toHaveBeenCalled(); expect(api.confirm).not.toHaveBeenCalled();
  });
  it("retains edits after a definite refusal and reanchors only on explicit reload", async () => {
    api.confirm.mockResolvedValueOnce({ ok: false, error: { code: "ineligible_state", retryOriginal: false, message: "This copy changed" } });
    await click("Edit"); await click("Change notes"); await click("Choose eBook"); await click("Preview edits and Link"); await click("Confirm decision");
    expect(host.textContent).toContain("This copy changed"); expect(host.querySelector('[data-draft-notes]')?.textContent).toBe("Chosen note");
    expect(api.readCopy).toHaveBeenCalledOnce(); expect(api.update).not.toHaveBeenCalled(); expect(api.notify).not.toHaveBeenCalled();
    const fresh = copyContext(); fresh.stamp.updatedAt = "2026-10-11T00:00:00.000002Z"; fresh.metadata.conditionNotes = "Another edit";
    const latest = options(); latest.value.editions[0].copies[0].stamp = fresh.stamp;
    api.readCopy.mockResolvedValueOnce({ ok: true, value: fresh }); api.readOptions.mockResolvedValueOnce(latest);
    await click("Reload current copy and keep my changed fields"); expect(host.querySelector('[data-draft-notes]')?.textContent).toBe("Chosen note");
    await click("Preview edits and Link");
    expect(api.prepare.mock.calls[1][0].intent).toEqual(expect.objectContaining({ existingCopyPatch: { notes: "Chosen note" }, expectedCopyStamp: fresh.stamp }));
    expect(api.update).not.toHaveBeenCalled();
  });
  it("ignores a cancelled initial snapshot and never offers a late editable Link", async () => {
    let resolve!: (value: unknown) => void; api.readCopy.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await click("Edit"); await click("Close dialog"); await act(async () => resolve({ ok: true, value: copyContext() }));
    expect(host.querySelector('[role="dialog"]')).toBeNull(); expect(api.prepare).not.toHaveBeenCalled();
  });
});
