// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, Fragment, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

// SLN-631: Enter is the main action in every dialog, a held Enter presses
// once, and a link, a key or the palette leaving unsaved work asks first.

const nav = vi.hoisted(() => ({ pathname: "/library/new", push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn(), prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/notifications/toast", () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }));
vi.mock("next/image", () => ({ default: () => null }));
// The Add dialogs and the sheet are not under test
vi.mock("@/app/(catalogue)/people/author-create-dialog", () => ({ AuthorCreateDialog: () => null }));
vi.mock("@/app/(catalogue)/places/venue-create-dialog", () => ({ VenueCreateDialog: () => null }));
vi.mock("@/components/collections/create-collection-dialog", () => ({ CreateCollectionDialog: () => null }));
vi.mock("@/components/recommenders/recommender-form-dialog", () => ({ RecommenderFormDialog: () => null }));
vi.mock("@/components/series/series-form-dialog", () => ({ SeriesFormDialog: () => null }));
vi.mock("@/components/shortcuts/shortcuts-help", () => ({ ShortcutsHelp: () => null }));
// Edit collection and the edition form, rendered for real (SLN-629's reported case)
const collections = vi.hoisted(() => ({ updateCollection: vi.fn(async () => {}) }));
vi.mock("@/lib/actions/collections", () => ({
  updateCollection: collections.updateCollection,
  deleteCollection: vi.fn(),
  moveCollectionMember: vi.fn(),
  removeEditionFromCollection: vi.fn(),
  removeWorksFromCollection: vi.fn(),
}));
vi.mock("@/components/media/media-manager-dialog", () => ({ MediaManagerDialog: () => null }));
vi.mock("@/components/collections/add-books-dialog", () => ({ AddCollectionBooksDialog: () => null }));
vi.mock("@/hooks/use-author-search", () => ({ useAuthorSearch: () => ({ results: [], loading: false }) }));

import { ShortcutsProvider } from "@/components/shortcuts/shortcuts-provider";
import { Dialog } from "@/components/ui/dialog";
import { leavePage } from "@/components/ui/unsaved-guard";
import { useEscapeToCancel } from "@/components/shared/escape-to-cancel";
import { isMacPlatform } from "@/lib/shortcuts/shortcuts";
import { CollectionControls } from "@/components/collections/collection-controls";
import { EditionForm, EMPTY_EDITION } from "@/components/books/edition-form";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  Element.prototype.getClientRects = function () {
    return [{}] as unknown as DOMRectList;
  };
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("http://localhost/library/new");
  nav.pathname = "/library/new";
  nav.push.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function key(target: EventTarget, init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}
const enter = (target: EventTarget, init: KeyboardEventInit = {}) => key(target, { key: "Enter", keyCode: 13, ...init });
function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true }));
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!;
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function click(el: Element, init: MouseEventInit = {}) {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  act(() => {
    el.dispatchEvent(event);
  });
  return event;
}
const prompt = () =>
  [...document.querySelectorAll("dialog[open]")].find((d) => d.textContent?.includes("Unsaved changes")) ?? null;
const answer = (name: string) =>
  [...(prompt()?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === name)!;

function withShortcuts(...children: Parameters<typeof createElement>[2][]) {
  return createElement(ShortcutsProvider, {
    paletteOpen: false,
    onPaletteOpenChange: () => {},
    children: createElement(Fragment, null, ...children),
  });
}

function EditDialog({ onSave, onDelete, aliases = false, saveOff = false }: { onSave: () => void; onDelete?: () => void; aliases?: boolean; saveOff?: boolean }) {
  return createElement(
    Dialog,
    { open: true, onClose: () => {}, title: "Edit collection", draft: true, children: null },
    createElement("textarea", { id: "description", defaultValue: "" }),
    aliases && createElement("textarea", { id: "aliases", "data-enter": "ignore", defaultValue: "" }),
    createElement("button", { type: "button", "data-dismiss": "" }, "Cancel"),
    onDelete
      ? createElement("button", { type: "button", "data-variant": "danger", onClick: onDelete }, "Delete")
      : createElement("button", { type: "button", "data-variant": "primary", disabled: saveOff, onClick: onSave }, "Save"),
  );
}

describe("Enter in a dialog", () => {
  it("saves from a text box; Shift+Enter is left for its new line", () => {
    const onSave = vi.fn();
    act(() => root.render(withShortcuts(createElement(EditDialog, { onSave }))));
    const box = document.getElementById("description")!;
    const shifted = enter(box, { shiftKey: true });
    expect(shifted.defaultPrevented).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
    const plain = enter(box);
    expect(plain.defaultPrevented).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("does nothing from a text box while its Save is off: no save and no new line", () => {
    const onSave = vi.fn();
    act(() => root.render(withShortcuts(createElement(EditDialog, { onSave, saveOff: true }))));
    const box = document.getElementById("description")!;
    expect(enter(box).defaultPrevented).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    // Shift+Enter still makes its new line
    expect(enter(box, { shiftKey: true }).defaultPrevented).toBe(false);
  });

  it("keeps the new line in a text box marked for lines", () => {
    const onSave = vi.fn();
    act(() => root.render(withShortcuts(createElement(EditDialog, { onSave, aliases: true }))));
    const event = enter(document.getElementById("aliases")!);
    expect(event.defaultPrevented).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves Edit collection from its Description with Enter (SLN-629)", async () => {
    collections.updateCollection.mockClear();
    const collection = { id: "c1", name: "Decadents", description: "" } as Parameters<typeof CollectionControls>[0]["collection"];
    act(() => root.render(withShortcuts(createElement(CollectionControls, { collection, editionIds: [] }))));
    click([...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Edit")!);
    const box = document.querySelector<HTMLTextAreaElement>("dialog[open] textarea")!;
    type(box, "Books that rot beautifully");
    expect(enter(box, { shiftKey: true }).defaultPrevented).toBe(false);
    expect(collections.updateCollection).not.toHaveBeenCalled();
    const event = enter(box);
    await act(async () => {});
    expect(event.defaultPrevented).toBe(true);
    expect(collections.updateCollection).toHaveBeenCalledTimes(1);
    expect(collections.updateCollection).toHaveBeenCalledWith("c1", { name: "Decadents", description: "Books that rot beautifully" });
  });

  it("keeps Enter for the next chapter in an edition's Table of contents", () => {
    const onSubmit = vi.fn(async () => {});
    act(() =>
      root.render(
        withShortcuts(
          createElement(
            Dialog,
            { open: true, onClose: () => {}, title: "Edit edition", draft: true, children: null },
            createElement(EditionForm, {
              initialValues: { ...EMPTY_EDITION, title: "Against Nature" },
              availableGenres: [],
              availableTags: [],
              onSubmit,
              submitLabel: "Save",
              isPending: false,
            }),
          ),
        ),
      ),
    );
    click([...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Content")!);
    const toc = document.getElementById("ed-toc") as HTMLTextAreaElement;
    type(toc, "I. Chapter one");
    expect(enter(toc).defaultPrevented).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
    // A prose box in the same form saves on Enter
    const description = document.getElementById("ed-description") as HTMLTextAreaElement;
    expect(enter(description).defaultPrevented).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("presses the main button with the focus on the dialog itself", () => {
    const onSave = vi.fn();
    act(() => root.render(withShortcuts(createElement(EditDialog, { onSave }))));
    enter(document.querySelector("dialog[open]")!);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("closes a dialog with nothing to save on Enter, through its Done (SLN-634)", () => {
    const onClose = vi.fn();
    act(() =>
      root.render(
        withShortcuts(createElement(Dialog, { open: true, onClose, title: "Keyboard shortcuts", done: true, children: "Sheet" })),
      ),
    );
    const done = [...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent === "Done")!;
    expect(done.getAttribute("data-variant")).toBe("primary");
    enter(document.querySelector("dialog[open]")!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("adds from a Done dialog's field on ⌘Enter, and keeps the dialog open", () => {
    // Collections and Manage media: a field with its own Add, then Done
    const onClose = vi.fn();
    const onAdd = vi.fn((e: { preventDefault(): void }) => e.preventDefault());
    act(() =>
      root.render(
        withShortcuts(
          createElement(Dialog, {
            open: true,
            onClose,
            title: "Collections",
            done: true,
            children: createElement(
              "form",
              { onSubmit: onAdd },
              createElement("input", { id: "add-field", defaultValue: "Zeta" }),
              createElement("button", { type: "submit", "data-shortcut": "save" }, "Create & add"),
            ),
          }),
        ),
      ),
    );
    const mod = isMacPlatform() ? { metaKey: true } : { ctrlKey: true };
    enter(document.getElementById("add-field")!, mod);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("never presses a Delete", () => {
    const onDelete = vi.fn();
    act(() => root.render(withShortcuts(createElement(EditDialog, { onSave: () => {}, onDelete }))));
    enter(document.querySelector("dialog[open]")!);
    enter(document.getElementById("description")!);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("presses once while Enter is held", () => {
    const onSave = vi.fn();
    act(() => root.render(withShortcuts(createElement(EditDialog, { onSave }))));
    const box = document.getElementById("description")!;
    enter(box);
    const mod = isMacPlatform() ? { metaKey: true } : { ctrlKey: true };
    const held = [enter(box, { repeat: true }), enter(box, { repeat: true, ...mod })];
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(held.every((e) => e.defaultPrevented)).toBe(true);
    // A held Enter on a button never clicks it again
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === "Save")!;
    expect(enter(save, { repeat: true }).defaultPrevented).toBe(true);
  });

  it("leaves a text box on a page its Enter, held or not", () => {
    act(() => root.render(withShortcuts(createElement("textarea", { id: "page-notes" }))));
    const box = document.getElementById("page-notes")!;
    expect(enter(box).defaultPrevented).toBe(false);
    expect(enter(box, { repeat: true }).defaultPrevented).toBe(false);
  });
});

/** A form page with links: the sidebar's, a tab of this page, a new tab */
function FormPage({ cancel }: { cancel: () => void }) {
  const form = useRef<HTMLDivElement>(null);
  const page = useEscapeToCancel({ root: form, cancel, track: true });
  return createElement(
    "div",
    null,
    page,
    createElement("a", { id: "away", href: "/authors" }, "Authors"),
    createElement("a", { id: "here", href: "/library/new?step=2" }, "Step 2"),
    createElement("a", { id: "tab", href: "/authors", target: "_blank" }, "Authors in a new tab"),
    createElement("div", { ref: form }, createElement("input", { id: "title" })),
  );
}

describe("leaving unsaved work", () => {
  let followed: string[];
  const follow = (event: Event) => {
    if (event.defaultPrevented || !(event.target instanceof HTMLAnchorElement)) return;
    followed.push(event.target.id);
    event.preventDefault(); // the test stays on its page
  };
  beforeEach(() => {
    followed = [];
    document.addEventListener("click", follow);
  });
  afterEach(() => document.removeEventListener("click", follow));

  it("follows a link at once when nothing is typed", () => {
    act(() => root.render(createElement(FormPage, { cancel: () => {} })));
    click(document.getElementById("away")!);
    expect(prompt()).toBeNull();
    expect(followed).toEqual(["away"]);
  });

  it("asks before a link leaves typed work; Keep editing stays, Discard follows it", () => {
    const cancel = vi.fn();
    act(() => root.render(createElement(FormPage, { cancel })));
    type(document.getElementById("title") as HTMLInputElement, "The Thing");
    click(document.getElementById("away")!);
    expect(followed).toEqual([]);
    expect(prompt()).not.toBeNull();
    click(answer("Keep editing"));
    expect(prompt()).toBeNull();
    expect(followed).toEqual([]);
    click(document.getElementById("away")!);
    click(answer("Discard"));
    expect(followed).toEqual(["away"]);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("lets links that stay on the page or open a new tab pass", () => {
    act(() => root.render(createElement(FormPage, { cancel: () => {} })));
    type(document.getElementById("title") as HTMLInputElement, "The Thing");
    click(document.getElementById("here")!);
    click(document.getElementById("tab")!);
    click(document.getElementById("away")!, { metaKey: true });
    expect(prompt()).toBeNull();
    expect(followed).toEqual(["here", "tab", "away"]);
  });

  it("asks before a key or the palette leaves typed work", () => {
    act(() => root.render(createElement(FormPage, { cancel: () => {} })));
    const go = vi.fn();
    act(() => leavePage(go));
    expect(go).toHaveBeenCalledTimes(1);
    type(document.getElementById("title") as HTMLInputElement, "The Thing");
    act(() => leavePage(go));
    expect(go).toHaveBeenCalledTimes(1);
    expect(prompt()).not.toBeNull();
    click(answer("Discard"));
    expect(go).toHaveBeenCalledTimes(2);
  });

  it("asks for a dialog's draft, then the page's, before following a link", () => {
    function Both() {
      const [dialog, setDialog] = useState(true);
      return createElement(
        Fragment,
        null,
        createElement(FormPage, { cancel: () => {} }),
        dialog &&
          createElement(
            Dialog,
            { open: true, onClose: () => setDialog(false), title: "Add person", draft: true, children: null },
            createElement("input", { id: "person" }),
            createElement("a", { id: "inside", href: "/people" }, "People"),
          ),
      );
    }
    act(() => root.render(createElement(Both)));
    type(document.getElementById("title") as HTMLInputElement, "The Thing");
    type(document.getElementById("person") as HTMLInputElement, "Jean Lorrain");
    click(document.getElementById("inside")!);
    expect(prompt()?.textContent).toContain("Unsaved changes");
    click(answer("Discard"));
    expect(followed).toEqual([]);
    expect(prompt()).not.toBeNull();
    click(answer("Discard"));
    expect(followed).toEqual(["inside"]);
  });
});
