// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Dialog } from "@/components/ui/dialog";
import { FeatureSurface } from "@/components/ui/feature-renderer";
import { DialogFocusScope } from "@/components/ui/dialog-focus-scope";
import { Select } from "@/components/ui/select";
import { draftState } from "@/lib/ui/draft-tracker";
import { hasOpenSurface } from "@/lib/ui/surface-state";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.getClientRects = function () { return [{}] as unknown as DOMRectList; };
});
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.restoreAllMocks();
  expect(hasOpenSurface()).toBe(false);
});

/** A feature-owned lease and its real shared-scope draft dialog, as in the reading host. */
function SharedParent({ onClose, hydrated = false, compact = false, show = true, newer = false }: {
  onClose(): void; hydrated?: boolean; compact?: boolean; show?: boolean; newer?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState("old");
  const [closedNewer, setClosedNewer] = useState(false);
  const close = () => { setOpen(false); onClose(); };
  if (!open) return null;
  return createElement(FeatureSurface, { close, children: null },
    createElement(Dialog, { open, onClose: close, title: "Edit note", draft: true, children: null },
      show && createElement(Select, {
        ariaLabel: "Reading", compact, value,
        onChange: event => setValue(event.target.value),
        options: [
          { value: "old", label: hydrated ? "30th read · English" : "Selected reading (loading…)", disabled: !hydrated },
          { value: "new", label: "501st read · reading now" },
        ],
      }),
      createElement("input", { "aria-label": "After", defaultValue: "" }),
      createElement("button", { type: "button", "data-outside": "" }, "Outside target"),
      createElement("button", { type: "button", "data-variant": "primary", onClick: close }, "Save"),
      newer && !closedNewer && createElement(DialogFocusScope.Provider, { value: null },
        createElement(Dialog, {
          open: true, title: "Newer dialog", onClose: () => setClosedNewer(true), children: createElement("input", { "aria-label": "Newer input" }),
        }),
      ),
    ),
  );
}
function render(props: Parameters<typeof SharedParent>[0]) {
  act(() => root.render(createElement(SharedParent, props)));
}
const parent = () => [...host.querySelectorAll<HTMLDialogElement>("dialog[open]")].find(el => el.querySelector("h2")?.textContent === "Edit note")!;
const trigger = () => host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
const option = (label: string) => [...host.querySelectorAll<HTMLElement>('[role="option"]')].find(el => el.querySelector("span")?.textContent === label)!;
const prompt = () => [...host.querySelectorAll("dialog[open]")].find(el => el.textContent?.includes("Unsaved changes"));
function pointer(el: Element, pointerType = "mouse") {
  act(() => {
    el.dispatchEvent(new PointerEvent("pointerdown", { pointerType, bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}
function key(target: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(event); }); return event;
}

it.each(["mouse", "touch"])("owns Escape after a disabled %s selection and label hydration without inventing a draft", pointerType => {
  const onClose = vi.fn(); render({ onClose });
  const before = draftState(parent());
  pointer(trigger(), pointerType);
  // Browsers may leave focus on the native dialog after clicking a non-focusable option.
  act(() => parent().focus());
  pointer(option("Selected reading (loading…)"), pointerType);
  expect(trigger().getAttribute("data-draft-value")).toBe("old");
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  render({ onClose, hydrated: true });
  expect(draftState(parent())).toBe(before);
  expect(key(parent(), "Escape").defaultPrevented).toBe(true);
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(trigger());
  expect(prompt()).toBeUndefined(); expect(onClose).not.toHaveBeenCalled();
  key(trigger(), "Escape");
  expect(onClose).toHaveBeenCalledTimes(1); expect(prompt()).toBeUndefined();
});

it.each([false, true])("real value changes stay dirty and restoring the value is clean (compact: %s)", compact => {
  const onClose = vi.fn(); render({ onClose, hydrated: true, compact });
  const before = draftState(parent());
  pointer(trigger()); pointer(option("501st read · reading now"));
  expect(document.activeElement).toBe(trigger());
  expect(draftState(parent())).not.toBe(before);
  key(trigger(), "Escape");
  expect(onClose).not.toHaveBeenCalled(); expect(prompt()).toBeDefined();
  const keep = [...prompt()!.querySelectorAll("button")].find(el => el.textContent === "Keep editing")!;
  pointer(keep); pointer(trigger()); pointer(option("30th read · English"));
  expect(draftState(parent())).toBe(before);
  key(trigger(), "Escape"); expect(onClose).toHaveBeenCalledTimes(1);
});

it("keeps a real dirty parent's guard for the next independent Escape", () => {
  const onClose = vi.fn(); render({ onClose, hydrated: true });
  pointer(trigger()); pointer(option("501st read · reading now")); pointer(trigger());
  act(() => parent().focus()); key(parent(), "Escape");
  expect(prompt()).toBeUndefined(); expect(onClose).not.toHaveBeenCalled();
  expect(trigger().getAttribute("aria-expanded")).toBe("false");
  key(trigger(), "Escape"); expect(prompt()).toBeDefined(); expect(onClose).not.toHaveBeenCalled();
});

it.each([
  { metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true },
])("keeps both layers on modified/held Escape %j", init => {
  const onClose = vi.fn(); render({ onClose, hydrated: true }); pointer(trigger());
  act(() => parent().focus());
  expect(key(parent(), "Escape", init).defaultPrevented).toBe(true);
  expect(trigger().getAttribute("aria-expanded")).toBe("true"); expect(onClose).not.toHaveBeenCalled();
  expect(prompt()).toBeUndefined();
});

it.each([{ isComposing: true }, { keyCode: 229 }])("leaves composing Escape with the input method %j", init => {
  const onClose = vi.fn(); render({ onClose, hydrated: true }); pointer(trigger());
  expect(key(trigger(), "Escape", init).defaultPrevented).toBe(false);
  expect(trigger().getAttribute("aria-expanded")).toBe("true"); expect(onClose).not.toHaveBeenCalled();
});

it("leaves an open native popover's Escape with the browser", () => {
  const onClose = vi.fn(); render({ onClose, hydrated: true }); pointer(trigger());
  const original = document.querySelector.bind(document), popover = document.createElement("div");
  vi.spyOn(document, "querySelector").mockImplementation(selector => selector === '[popover="auto"]:popover-open' ? popover : original(selector));
  expect(key(parent(), "Escape").defaultPrevented).toBe(false);
  expect(trigger().getAttribute("aria-expanded")).toBe("true"); expect(onClose).not.toHaveBeenCalled();
});

it("outside pointer and Tab keep the next focus destination", () => {
  const onClose = vi.fn(); render({ onClose, hydrated: true }); pointer(trigger());
  const outside = host.querySelector<HTMLButtonElement>("[data-outside]")!;
  act(() => outside.focus()); pointer(outside);
  expect(trigger().getAttribute("aria-expanded")).toBe("false"); expect(document.activeElement).toBe(outside);
  act(() => trigger().focus()); key(trigger(), "Enter");
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  expect(key(trigger(), "Tab").defaultPrevented).toBe(false);
  const after = host.querySelector<HTMLInputElement>('[aria-label="After"]')!;
  act(() => after.focus());
  expect(trigger().getAttribute("aria-expanded")).toBe("false"); expect(document.activeElement).toBe(after);
});

it("keyboard activation cannot choose a disabled value", () => {
  const onClose = vi.fn(); render({ onClose }); act(() => trigger().focus());
  key(trigger(), "Enter"); key(trigger(), "Enter");
  expect(trigger().getAttribute("data-draft-value")).toBe("old");
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  key(trigger(), "Escape"); expect(prompt()).toBeUndefined(); expect(onClose).not.toHaveBeenCalled();
});

it("a newer dialog owns Escape before the still-open Select", () => {
  const onClose = vi.fn(); render({ onClose, hydrated: true }); pointer(trigger());
  render({ onClose, hydrated: true, newer: true });
  const input = host.querySelector<HTMLInputElement>('[aria-label="Newer input"]')!;
  key(input, "Escape");
  expect(host.querySelector('[aria-label="Newer input"]')).toBeNull();
  expect(trigger().getAttribute("aria-expanded")).toBe("true"); expect(onClose).not.toHaveBeenCalled();
  key(parent(), "Escape"); expect(trigger().getAttribute("aria-expanded")).toBe("false");
});

it("unmounting the Select releases its lease without moving newer focus", () => {
  const onClose = vi.fn(); render({ onClose, hydrated: true }); pointer(trigger());
  const outside = host.querySelector<HTMLButtonElement>("[data-outside]")!;
  act(() => outside.focus()); render({ onClose, hydrated: true, show: false });
  expect(document.activeElement).toBe(outside); key(outside, "Escape"); expect(onClose).toHaveBeenCalledTimes(1);
});
