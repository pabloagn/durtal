// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, Fragment, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

// SLN-631: Enter is the main action in every dialog (a text box keeps it for
// its new line; ⌘Enter saves there), a held Enter presses
// once, and a link, a key or the palette leaving unsaved work asks first.

const nav = vi.hoisted(() => ({ pathname: "/library/new", push: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn(), prefetch: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {} }) }));
vi.mock("next/image", () => ({ default: () => null }));
// The Add dialogs and the sheet are not under test
vi.mock("@/app/(catalogue)/people/author-create-dialog", () => ({ AuthorCreateDialog: () => null }));
vi.mock("@/app/(catalogue)/places/venue-create-dialog", () => ({ VenueCreateDialog: () => null }));
vi.mock("@/components/collections/create-collection-dialog", () => ({ CreateCollectionDialog: () => null }));
vi.mock("@/components/recommenders/recommender-form-dialog", () => ({ RecommenderFormDialog: () => null }));
vi.mock("@/components/series/series-form-dialog", () => ({ SeriesFormDialog: () => null }));
vi.mock("@/components/shortcuts/shortcuts-help", () => ({ ShortcutsHelp: () => null }));

import { ShortcutsProvider } from "@/components/shortcuts/shortcuts-provider";
import { Dialog } from "@/components/ui/dialog";
import { leavePage } from "@/components/ui/unsaved-guard";
import { useEscapeToCancel } from "@/components/shared/escape-to-cancel";
import { isMacPlatform } from "@/lib/shortcuts/shortcuts";

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

function EditDialog({ onSave, onDelete }: { onSave: () => void; onDelete?: () => void }) {
  return createElement(
    Dialog,
    { open: true, onClose: () => {}, title: "Edit collection", draft: true, children: null },
    createElement("input", { id: "name", defaultValue: "" }),
    createElement("textarea", { id: "description", defaultValue: "" }),
    createElement("button", { type: "button", "data-dismiss": "" }, "Cancel"),
    onDelete
      ? createElement("button", { type: "button", "data-variant": "danger", onClick: onDelete }, "Delete")
      : createElement("button", { type: "button", "data-variant": "primary", onClick: onSave }, "Save"),
  );
}

describe("Enter in a dialog", () => {
  it("saves from a one-line field", () => {
    const onSave = vi.fn();
    act(() => root.render(withShortcuts(createElement(EditDialog, { onSave }))));
    expect(enter(document.getElementById("name")!).defaultPrevented).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("leaves a text box its new line, held or not; ⌘Enter saves from it", () => {
    const onSave = vi.fn();
    act(() => root.render(withShortcuts(createElement(EditDialog, { onSave }))));
    const box = document.getElementById("description")!;
    for (const init of [{}, { shiftKey: true }, { repeat: true }])
      expect(enter(box, init).defaultPrevented).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
    const mod = isMacPlatform() ? { metaKey: true } : { ctrlKey: true };
    expect(enter(box, mod).defaultPrevented).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("presses the main button with the focus on the dialog itself", () => {
    const onSave = vi.fn();
    act(() => root.render(withShortcuts(createElement(EditDialog, { onSave }))));
    enter(document.querySelector("dialog[open]")!);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("never presses a Delete", () => {
    const onDelete = vi.fn();
    act(() => root.render(withShortcuts(createElement(EditDialog, { onSave: () => {}, onDelete }))));
    enter(document.querySelector("dialog[open]")!);
    enter(document.getElementById("name")!);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("presses once while Enter is held", () => {
    const onSave = vi.fn();
    act(() => root.render(withShortcuts(createElement(EditDialog, { onSave }))));
    const box = document.getElementById("name")!;
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
