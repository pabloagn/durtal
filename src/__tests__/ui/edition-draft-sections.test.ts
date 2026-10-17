// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Dialog } from "@/components/ui/dialog";
import { FormSection } from "@/components/shared/form-section";
import { EditionForm, EMPTY_EDITION, type EditionFormValues } from "@/components/books/edition-form";
import { draftState } from "@/lib/ui/draft-tracker";
import { hasOpenSurface } from "@/lib/ui/surface-state";

// Keep the real EditionForm, sections, fields, Select and draft guard mounted.
// Only remote searches are replaced; these cases never submit or call a provider.
vi.mock("@/hooks/use-author-search", () => ({ useAuthorSearch: () => ({ results: [], isSearching: false }) }));
vi.mock("@/hooks/use-publisher-search", () => ({ usePublisherSearch: () => ({ results: [], isSearching: false }) }));
vi.mock("@/lib/actions/publishers", () => ({ createPublisherFromName: vi.fn() }));

let host: HTMLDivElement;
let root: Root;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  Element.prototype.scrollIntoView = vi.fn();
  // Focus discovery must see collapsed fields as hidden, unlike a blanket
  // getClientRects stub that would give the dialog fake autofocus candidates.
  Element.prototype.getClientRects = function () {
    return (this.closest("[hidden], [inert]") ? [] : [{}]) as unknown as DOMRectList;
  };
});
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove();
  expect(hasOpenSurface()).toBe(false);
});

function EditionDraft({ onClose, create = false, initial = {} }: {
  onClose(): void; create?: boolean; initial?: Partial<EditionFormValues>;
}) {
  const [open, setOpen] = useState(true);
  const close = () => { setOpen(false); onClose(); };
  return createElement(Dialog, { open, title: create ? "Add edition" : "Edit edition", onClose: close, draft: true, children: null },
    createElement(EditionForm, {
      initialValues: { ...EMPTY_EDITION, title: "Synthetic edition", language: "en", ...initial },
      availableGenres: [], availableTags: [], onSubmit: async () => {}, onCancel: close,
      submitLabel: create ? "Create edition" : "Save changes", isPending: false,
      existingCoverUrl: "/synthetic-cover.jpg",
    }),
  );
}
function render(props: Parameters<typeof EditionDraft>[0]) {
  act(() => root.render(createElement(EditionDraft, props)));
}
const parent = () => host.querySelector<HTMLDialogElement>("dialog[open]")!;
const field = (id: string) => host.querySelector<HTMLInputElement>("#" + id)!;
const section = (name: string) => [...host.querySelectorAll<HTMLElement>("section")].find(el => el.querySelector(":scope > h3 > button")?.textContent?.trim() === name)!;
const toggle = (name: string) => section(name).querySelector<HTMLButtonElement>(":scope > h3 > button")!;
const prompt = () => [...host.querySelectorAll<HTMLDialogElement>("dialog[open]")].find(el => el.querySelector("h2")?.textContent === "Unsaved changes");
const option = (name: string) => [...host.querySelectorAll<HTMLElement>('[role="option"]')].find(el => el.querySelector("span")?.textContent === name)!;
function pointer(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse" }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.focus();
    el.click();
  });
}
function key(el: Element, value: string) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  act(() => { el.dispatchEvent(event); }); return event;
}
function type(el: HTMLInputElement, value: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function keepEditing() {
  const keep = [...prompt()!.querySelectorAll<HTMLButtonElement>("button")].find(el => el.textContent === "Keep editing")!;
  pointer(keep);
  await act(() => new Promise(resolve => setTimeout(resolve, 5)));
}
function chooseLanguage(name: string) {
  pointer(host.querySelector<HTMLButtonElement>("#ed-language")!); pointer(option(name));
}

it.each([false, true])("expanding untouched edition sections stays clean (create: %s)", create => {
  const onClose = vi.fn(); render({ onClose, create });
  const before = draftState(parent());
  expect(document.activeElement).toBe(field("ed-title"));
  expect(field("ed-language").closest("fieldset[disabled]")).not.toBeNull();
  pointer(toggle("Language"));
  expect(draftState(parent())).toBe(before);
  expect(field("ed-language").getAttribute("data-draft-value")).toBe("en");
  pointer(toggle("Language")); pointer(toggle("More identifiers"));
  expect(draftState(parent())).toBe(before);
  key(toggle("More identifiers"), "Escape");
  expect(onClose).toHaveBeenCalledOnce(); expect(prompt()).toBeUndefined();
});

it.each([false, true])("restoring a Select value is clean after a real dirty guard (create: %s)", async create => {
  const onClose = vi.fn(); render({ onClose, create }); pointer(toggle("Language"));
  const before = draftState(parent());
  chooseLanguage("French"); key(field("ed-language"), "Escape");
  expect(prompt()).toBeDefined(); expect(onClose).not.toHaveBeenCalled();
  await keepEditing(); chooseLanguage("English");
  expect(draftState(parent())).toBe(before);
  key(field("ed-language"), "Escape");
  expect(prompt()).toBeUndefined(); expect(onClose).toHaveBeenCalledOnce();
});

it("does not erase a title edit when another section expands", () => {
  const onClose = vi.fn(); render({ onClose });
  type(field("ed-title"), "Changed title"); pointer(toggle("Language"));
  key(field("ed-language"), "Escape");
  expect(prompt()).toBeDefined(); expect(onClose).not.toHaveBeenCalled();
  expect(field("ed-title").value).toBe("Changed title");
});

it("keeps edited fields dirty through collapse and reopen", () => {
  const onClose = vi.fn(); render({ onClose }); pointer(toggle("Content"));
  const notes = host.querySelector<HTMLTextAreaElement>("#ed-notes")!;
  act(() => {
    notes.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(notes, "Keep this draft");
    notes.dispatchEvent(new Event("input", { bubbles: true }));
  });
  pointer(toggle("Content")); pointer(toggle("Content"));
  expect(host.querySelector("#ed-notes")).toBe(notes); expect(notes.value).toBe("Keep this draft");
  pointer(toggle("Content")); key(toggle("Content"), "Escape");
  expect(prompt()).toBeDefined(); expect(onClose).not.toHaveBeenCalled();
});

it("preserves a contributor removal as an edit", () => {
  const onClose = vi.fn(); render({ onClose, initial: { contributors: [{ authorId: "synthetic-author", authorName: "Synthetic contributor", role: "translator" }] } });
  pointer(toggle("Contributors")); pointer(host.querySelector<HTMLButtonElement>('[aria-label="Remove contributor"]')!);
  pointer(toggle("Contributors")); key(toggle("Contributors"), "Escape");
  expect(prompt()).toBeDefined(); expect(onClose).not.toHaveBeenCalled();
});

it("keeps conditional fields conditional and recognizes restoring the original switch", () => {
  const onClose = vi.fn(); render({ onClose }); const before = draftState(parent()); pointer(toggle("Edition details"));
  const limited = [...section("Edition details").querySelectorAll<HTMLLabelElement>("label")].find(el => el.textContent?.trim() === "Limited edition")!.querySelector<HTMLInputElement>("input")!;
  pointer(limited); expect(field("ed-limited-count")).not.toBeNull();
  pointer(limited); expect(field("ed-limited-count")).toBeNull(); expect(draftState(parent())).toBe(before);
  key(toggle("Edition details"), "Escape"); expect(onClose).toHaveBeenCalledOnce();
});

it("releases an open Select when a native outside pointer collapses its section", () => {
  const onClose = vi.fn(); render({ onClose }); pointer(toggle("Language"));
  pointer(field("ed-language")); expect(host.querySelector('[role="listbox"]')).not.toBeNull();
  pointer(toggle("Language"));
  expect(host.querySelector('[role="listbox"]')).toBeNull(); expect(document.activeElement).toBe(toggle("Language"));
  key(toggle("Language"), "Escape"); expect(onClose).toHaveBeenCalledOnce();
});

it("lets Tab leave the Select before its section collapses", () => {
  const onClose = vi.fn(); render({ onClose }); pointer(toggle("Language")); pointer(field("ed-language"));
  expect(key(field("ed-language"), "Tab").defaultPrevented).toBe(false);
  expect(host.querySelector('[role="listbox"]')).toBeNull();
  pointer(toggle("Language")); key(toggle("Language"), "Escape"); expect(onClose).toHaveBeenCalledOnce();
});

it("keeps collapsed fields hidden, inert and outside native validation until expanded", () => {
  const onClose = vi.fn(); render({ onClose });
  const pane = section("Cover").querySelector<HTMLFieldSetElement>("fieldset")!;
  expect(pane.hidden).toBe(true); expect(pane.hasAttribute("inert")).toBe(true); expect(pane.disabled).toBe(true);
  const cover = field("ed-cover-url");
  pointer(toggle("Cover")); type(cover, "invalid url");
  expect(cover.checkValidity()).toBe(false);
  pointer(toggle("Cover")); expect(cover.checkValidity()).toBe(true);
  expect(cover.value).toBe("invalid url");
  pointer(toggle("Cover")); expect(cover.checkValidity()).toBe(false);
  expect(section("Cover").querySelector("img")?.getAttribute("loading")).toBe("lazy");
});

it("leaves non-opted-in FormSection callers conditionally mounted", () => {
  act(() => root.render(createElement(FormSection, { title: "Copy notes", children: createElement("input", { id: "copy-notes" }) })));
  expect(host.querySelector("#copy-notes")).toBeNull();
  pointer(toggle("Copy notes")); expect(host.querySelector("#copy-notes")).not.toBeNull();
  pointer(toggle("Copy notes")); expect(host.querySelector("#copy-notes")).toBeNull();
});
