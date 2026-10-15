// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DetailsStep } from "@/app/(catalogue)/library/new/steps/details-step";
import type { SearchStep } from "@/app/(catalogue)/library/new/steps/search-step";
import type { DuplicateStep } from "@/app/(catalogue)/library/new/steps/duplicate-step";
import type { EditionStep } from "@/app/(catalogue)/library/new/steps/edition-step";
import type { CategorizeStep } from "@/app/(catalogue)/library/new/steps/categorize-step";
import type { ConfirmStep } from "@/app/(catalogue)/library/new/steps/confirm-step";
import type { refreshSuggestionsForCreatedBook } from "@/lib/actions/ebook-review-suggestions";
import { workId } from "../ebooks/review-ui-fixtures";
const api = vi.hoisted(() => ({ wizard: vi.fn(), fastTrack: vi.fn(), suggestions: vi.fn(), duplicate: vi.fn(),
  push: vi.fn(), back: vi.fn(), setQuery: vi.fn(), clearResults: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: api.push, back: api.back }) }));
vi.mock("@/lib/notifications/toast", () => ({ toast: { success: api.success, info: api.info, error: api.error, warning: api.warning } }));
vi.mock("@/lib/actions/wizard", () => ({ createBookFromWizard: api.wizard, isIsbnInUse: vi.fn() }));
vi.mock("@/lib/actions/fast-track", () => ({ fastTrackBook: api.fastTrack }));
vi.mock("@/lib/actions/works", () => ({ findDuplicateWork: api.duplicate }));
vi.mock("@/lib/actions/ebook-review-suggestions", () => ({ refreshSuggestionsForCreatedBook: api.suggestions }));
vi.mock("@/lib/hooks/use-app-settings", () => ({ useAppSettings: () => ({ newBookLanguage: "en", newBookStatus: "wishlist", newCopyLocationId: null }) }));
vi.mock("@/lib/hooks/use-debounced-search", () => ({ useDebouncedSearch: () => ({ setQuery: api.setQuery, clearResults: api.clearResults }) }));
vi.mock("@/app/(catalogue)/library/new/use-wizard-options", () => ({ useWizardOptions: () => ({ recommenders: [], locations: [], lists: {}, defaultLocationId: null }) }));
// Step form controls are boundaries; the mounted wizard, creation guards,
// input capture, actual suggestion feedback and navigation stay real.
vi.mock("@/app/(catalogue)/library/new/step-progress", () => ({ StepProgress: () => null }));
vi.mock("@/app/(catalogue)/library/new/steps/search-step", () => ({ SearchStep: ({ onManual, onSelect }: ComponentProps<typeof SearchStep>) =>
  createElement("div", null, createElement("button", { onClick: onManual }, "Enter manually"),
    createElement("button", { onClick: () => onSelect({ source: "open_library", sourceId: "fixture", title: "Nadja", authors: ["André Breton"], categories: [] }) }, "Choose search result")) }));
vi.mock("@/app/(catalogue)/library/new/steps/details-step", () => ({ DetailsStep: ({ onChange, onNext, onFastTrack, fastTrackError }: ComponentProps<typeof DetailsStep>) =>
  createElement("div", null, createElement("button", { onClick: () => onChange({ title: "Nadja", authorName: "André Breton" }) }, "Fill book"),
    createElement("button", { onClick: onNext }, "Edition"), createElement("button", { onClick: onFastTrack }, "Fast Track"), fastTrackError) }));
vi.mock("@/app/(catalogue)/library/new/steps/duplicate-step", () => ({ DuplicateStep: ({ onAddEdition }: ComponentProps<typeof DuplicateStep>) =>
  createElement("button", { onClick: onAddEdition }, "Add edition") }));
vi.mock("@/app/(catalogue)/library/new/steps/edition-step", () => ({ EditionStep: ({ onLeave }: ComponentProps<typeof EditionStep>) =>
  createElement("button", { onClick: () => onLeave("categorize") }, "Skip copies") }));
vi.mock("@/app/(catalogue)/library/new/steps/categorize-step", () => ({ CategorizeStep: ({ onNext }: ComponentProps<typeof CategorizeStep>) =>
  createElement("button", { onClick: onNext }, "Review book") }));
vi.mock("@/app/(catalogue)/library/new/steps/confirm-step", () => ({ ConfirmStep: ({ onSubmit }: ComponentProps<typeof ConfirmStep>) =>
  createElement("button", { onClick: onSubmit }, "Add book") }));
import { AddBookWizard } from "@/app/(catalogue)/library/new/wizard";
let root: Root; let host: HTMLElement;
const success = () => ({ ok: true, workId, slug: "nadja", coverUnavailable: false });
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(async () => {
  vi.resetAllMocks(); api.wizard.mockResolvedValue(success()); api.fastTrack.mockResolvedValue(success()); api.duplicate.mockResolvedValue(null);
  api.suggestions.mockResolvedValue({ workId, suggestionCount: 2, status: "ready" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(AddBookWizard, { then: "past" })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function click(label: string) { await act(async () => {
  const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label);
  if (!button) throw new Error(`Missing ${label}`); button.click();
}); }
async function prepare(mode: "wizard" | "fastTrack") {
  await click("Enter manually"); await click("Fill book");
  if (mode === "wizard") { await click("Edition"); await click("Skip copies"); await click("Review book"); }
}
const button = (mode: "wizard" | "fastTrack") => mode === "wizard" ? "Add book" : "Fast Track";
describe("mounted creation suggestion consumers", () => {
  it.each(["wizard", "fastTrack"] as const)("%s offers the actual count for the saved UUID and preserves reading navigation", async (mode) => {
    await prepare(mode); await click(button(mode));
    expect(api[mode]).toHaveBeenCalledOnce(); expect(api.suggestions).toHaveBeenCalledWith({ workId });
    expect(api.info.mock.calls[0][0]).toBe("2 eBook suggestions for this book");
    expect(api.push).toHaveBeenCalledWith("/library/nadja?then=past");
    api.info.mock.calls[0][1].action.onClick(); expect(api.push).toHaveBeenLastCalledWith(`/ebooks/review?work=${workId}`);
    expect(api.error).not.toHaveBeenCalled();
  });
  it.each(["wizard", "fastTrack"] as const)("%s never requests suggestions after failed creation and permits a genuine retry", async (mode) => {
    api[mode].mockResolvedValueOnce({ ok: false, error: "Could not save" });
    await prepare(mode); await click(button(mode)); expect(api.suggestions).not.toHaveBeenCalled(); expect(api.push).not.toHaveBeenCalled();
    await click(button(mode)); expect(api[mode]).toHaveBeenCalledTimes(2); expect(api.suggestions).toHaveBeenCalledOnce();
  });
  it.each(["wizard", "fastTrack"] as const)("%s preserves saved-book success when suggestion transport is unavailable", async (mode) => {
    api.suggestions.mockRejectedValueOnce(new Error("lost response"));
    await prepare(mode); await click(button(mode));
    expect(api.success).toHaveBeenCalledWith("Book added to catalogue");
    expect(api.info).toHaveBeenCalledWith("Book added. eBook suggestions could not be checked yet.");
    expect(api.error).not.toHaveBeenCalled(); expect(host.textContent).not.toContain("Could not add the book");
    expect(api.push).toHaveBeenCalledWith("/library/nadja?then=past");
    await click(button(mode)); expect(api[mode]).toHaveBeenCalledOnce();
  });
  it.each(["wizard", "fastTrack"] as const)("%s guards duplicate creation while the saved book's suggestions are pending", async (mode) => {
    let resolve!: (value: Awaited<ReturnType<typeof refreshSuggestionsForCreatedBook>>) => void;
    api.suggestions.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await prepare(mode); await click(button(mode)); await click(button(mode));
    expect(api[mode]).toHaveBeenCalledOnce(); expect(api.suggestions).toHaveBeenCalledOnce(); expect(api.push).not.toHaveBeenCalled();
    await act(async () => resolve({ workId, suggestionCount: 0, status: "ready" }));
    expect(api.push).toHaveBeenCalledWith("/library/nadja?then=past"); expect(api.info).not.toHaveBeenCalled();
  });
  it("does not request new-book suggestions when adding an edition to an existing work", async () => {
    const existing = "77777777-7777-4777-8777-777777777777";
    api.duplicate.mockResolvedValueOnce({ id: existing, title: "Nadja", workAuthors: [], editions: [] });
    api.wizard.mockResolvedValueOnce({ ...success(), workId: existing });
    await click("Choose search result"); await click("Add edition"); await click("Skip copies"); await click("Review book"); await click("Add book");
    expect(api.wizard.mock.calls[0][0].existingWorkId).toBe(existing); expect(api.suggestions).not.toHaveBeenCalled();
    expect(api.push).toHaveBeenCalledWith("/library/nadja?then=past");
  });
});
