// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog } from "@/components/ui/dialog";
import { acquireSurface, hasOpenSurface, type SurfaceLease } from "@/lib/ui/surface-state";

let root: Root, host: HTMLDivElement;
let extra: SurfaceLease | null = null;
const parentClosed = vi.fn();
const dateChanged = vi.fn();
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
beforeEach(() => {
  parentClosed.mockClear(); dateChanged.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  extra?.release(); extra = null;
  await act(async () => { root.unmount(); await Promise.resolve(); });
  host.remove();
  expect(hasOpenSurface()).toBe(false);
});

function Parent({ dirty = false }: { dirty?: boolean }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("2026-10-16");
  return h("div", null,
    h("button", { id: "opener", onClick: () => setOpen(true) }, "Open parent"),
    h(Dialog, {
      open, title: "Parent", dirty,
      onClose: () => { parentClosed(); setOpen(false); },
      children: h("div", null,
        h(DatePicker, { label: "Date", id: "date", value: date, min: "2026-10-15", max: "2026-10-17",
          onChange: (value: string) => { dateChanged(value); setDate(value); } }),
        h("button", { id: "other", type: "button" }, "Other field")),
    }));
}
const trigger = () => document.getElementById("date") as HTMLButtonElement;
const grid = () => document.querySelector('[role="grid"]');
const parent = () => [...document.querySelectorAll("dialog[open]")].find(dialog =>
  dialog.querySelector("h2")?.textContent === "Parent");
function open(dirty = false) {
  act(() => root.render(h(Parent, { dirty })));
  act(() => {
    const opener = document.getElementById("opener") as HTMLButtonElement;
    opener.focus();
    opener.click();
  });
  act(() => { trigger().focus(); trigger().click(); });
  expect(grid()).not.toBeNull();
}
function escape(init: KeyboardEventInit = {}, code?: number) {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, ...init });
  if (code !== undefined) Object.defineProperty(event, "keyCode", { value: code });
  act(() => (document.activeElement ?? document.body).dispatchEvent(event));
  return event;
}
const day = (date: string) => document.querySelector<HTMLButtonElement>(`[data-day="${date}"] button`)!;

describe("calendar surface ownership", () => {
  it("closes only the calendar first, restores its trigger, then closes a clean parent", async () => {
    open();
    act(() => day("2026-10-16").focus());
    expect(escape().defaultPrevented).toBe(true);
    expect(grid()).toBeNull();
    expect(parent()).toBeTruthy();
    expect(parentClosed).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger());
    expect(escape().defaultPrevented).toBe(true);
    await act(async () => { await Promise.resolve(); });
    expect(parentClosed).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(document.getElementById("opener"));
  });

  it("does not ask the dirty parent to close until the next fresh Escape", () => {
    open(true);
    escape();
    expect(grid()).toBeNull();
    expect(document.body.textContent).not.toContain("Unsaved changes");
    expect(parentClosed).not.toHaveBeenCalled();
    escape({ repeat: true });
    expect(document.body.textContent).not.toContain("Unsaved changes");
    expect(parentClosed).not.toHaveBeenCalled();
    escape();
    expect(document.body.textContent).toContain("Unsaved changes");
    expect(parentClosed).not.toHaveBeenCalled();
    escape();
    expect(document.body.textContent).not.toContain("Unsaved changes");
    expect(parent()).toBeTruthy();
  });

  it("consumes a held Escape without closing the calendar or subsequent parent", () => {
    open();
    expect(escape({ repeat: true }).defaultPrevented).toBe(true);
    expect(grid()).not.toBeNull();
    escape();
    expect(grid()).toBeNull();
    expect(escape({ repeat: true }).defaultPrevented).toBe(true);
    expect(parent()).toBeTruthy();
    expect(parentClosed).not.toHaveBeenCalled();
  });

  it.each([
    { isComposing: true }, { metaKey: true }, { ctrlKey: true },
    { altKey: true }, { shiftKey: true },
  ])("does not claim composition or modified Escape: %j", init => {
    open();
    expect(escape(init).defaultPrevented).toBe(false);
    expect(grid()).not.toBeNull();
    expect(parentClosed).not.toHaveBeenCalled();
  });

  it("does not claim Safari's keyCode-229 composition Escape", () => {
    open();
    expect(escape({}, 229).defaultPrevented).toBe(false);
    expect(grid()).not.toBeNull();
    expect(parentClosed).not.toHaveBeenCalled();
  });

  it("keeps upstream ownership of an already prevented Escape", () => {
    open();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    act(() => trigger().dispatchEvent(event));
    expect(grid()).not.toBeNull();
    expect(parentClosed).not.toHaveBeenCalled();
  });

  it("keeps a newer top surface ahead of the calendar", () => {
    open();
    const newerClosed = vi.fn(() => { extra?.release(); extra = null; });
    extra = acquireSurface(newerClosed);
    escape();
    expect(newerClosed).toHaveBeenCalledOnce();
    expect(grid()).not.toBeNull();
    expect(parentClosed).not.toHaveBeenCalled();
    escape();
    expect(grid()).toBeNull();
    expect(parent()).toBeTruthy();
  });

  it("preserves date limits and restores focus after selection", () => {
    open();
    expect(day("2026-10-14").disabled).toBe(true);
    expect(day("2026-10-15").disabled).toBe(false);
    expect(day("2026-10-17").disabled).toBe(false);
    expect(day("2026-10-18").disabled).toBe(true);
    act(() => { day("2026-10-17").focus(); day("2026-10-17").click(); });
    expect(dateChanged).toHaveBeenCalledExactlyOnceWith("2026-10-17");
    expect(grid()).toBeNull();
    expect(trigger().dataset.draftValue).toBe("2026-10-17");
    expect(document.activeElement).toBe(trigger());
    expect(parent()).toBeTruthy();
  });

  it("restores focus after clearing a date", () => {
    open();
    const clear = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Clear date")!;
    act(() => { clear.focus(); clear.click(); });
    expect(dateChanged).toHaveBeenCalledExactlyOnceWith("");
    expect(grid()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("keeps the destination focus on an outside pointer click", () => {
    open();
    const other = document.getElementById("other") as HTMLButtonElement;
    act(() => {
      other.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      other.focus();
    });
    expect(grid()).toBeNull();
    expect(document.activeElement).toBe(other);
    expect(parentClosed).not.toHaveBeenCalled();
  });

  it("releases an open calendar when its parent unmounts", async () => {
    open();
    expect(hasOpenSurface()).toBe(true);
    await act(async () => { root.render(null); await Promise.resolve(); });
    expect(hasOpenSurface()).toBe(false);
    expect(escape().defaultPrevented).toBe(false);
  });
});
