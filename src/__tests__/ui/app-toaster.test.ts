// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { AppToaster } from "@/components/layout/app-toaster";
import { TooltipLayer } from "@/components/ui/tooltip";

// Every toast has its own cross (SLN-567): it dismisses that toast alone and
// runs none of its actions.

let root: Root;
let host: HTMLElement;
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const toasts = () => [...document.querySelectorAll<HTMLElement>("[data-sonner-toast]")];
const textOf = (el: HTMLElement) => el.querySelector("[data-title]")?.textContent;
const popoverCalls: string[] = [];
const holder = () => document.querySelector<HTMLElement>("[data-toast-holder]")!;
const layer = () => document.querySelector<HTMLElement>("[data-toast-layer]")!;
/** A modal dialog, as the app opens one; a move out of the page hides a popover */
async function openDialog() {
  const dialog = document.createElement("dialog");
  document.body.append(dialog);
  dialog.setAttribute("open", "");
  await wait(50);
  return dialog;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // happy-dom knows neither :focus-visible nor the popover API: every focus
  // here comes from the keyboard, and the popover is a flag.
  const matches = Element.prototype.matches;
  Element.prototype.matches = function (selector: string) {
    if (selector === ":focus-visible") return this === document.activeElement;
    if (selector === ":popover-open") return this.hasAttribute("data-open");
    if (selector === ":modal") return this instanceof HTMLDialogElement && this.hasAttribute("open");
    return matches.call(this, selector);
  };
  HTMLElement.prototype.showPopover = function () {
    popoverCalls.push("show");
    this.setAttribute("data-open", "");
  };
  HTMLElement.prototype.hidePopover = function () {
    popoverCalls.push("hide");
    this.removeAttribute("data-open");
  };
  // A browser hides an open popover that is moved: it leaves the document first
  const append = Element.prototype.append;
  Element.prototype.append = function (this: Element, ...nodes: (Node | string)[]) {
    for (const node of nodes)
      if (node instanceof Element && node.isConnected) node.querySelectorAll("[popover]").forEach((el) => el.removeAttribute("data-open"));
    return append.apply(this, nodes);
  };
});
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement("div", null, createElement(TooltipLayer), createElement(AppToaster))));
});
afterEach(() => {
  act(() => toast.dismiss());
  act(() => root.unmount());
  host.remove();
});

describe("the app's toasts", () => {
  it("gives each toast a labelled cross that dismisses only that toast", async () => {
    const undo = vi.fn();
    act(() => {
      toast.success("Image adjustments saved", { action: { label: "Undo", onClick: undo } });
      toast("Added to Favourites");
    });
    await wait(50);
    expect(toasts().map(textOf).sort()).toEqual(["Added to Favourites", "Image adjustments saved"]);
    const crosses = document.querySelectorAll<HTMLButtonElement>("[data-sonner-toast] [data-close-button]");
    expect([...crosses].map((b) => b.getAttribute("aria-label"))).toEqual(["Dismiss", "Dismiss"]);
    // The cross is an icon, not text
    expect(crosses[0].textContent).toBe("");
    expect(crosses[0].querySelector("svg")).not.toBeNull();

    // Sonner takes no attribute for its cross: its label is its tooltip.
    // Tab reaches it (a focus that follows no key shows no tooltip)
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" })));
    act(() => crosses[0].focus());
    await wait(20);
    expect(document.getElementById("app-tooltip")?.textContent).toContain("Dismiss");

    const saved = toasts().find((t) => textOf(t) === "Image adjustments saved")!;
    act(() => saved.querySelector<HTMLButtonElement>("[data-close-button]")!.click());
    await wait(500);
    expect(toasts().map(textOf)).toEqual(["Added to Favourites"]);
    expect(undo).not.toHaveBeenCalled();
  });

  // SLN-1464: lifting the layer costs a style recalculation, slow on a phone
  it("leaves the toast layer alone when a dialog opens with no toast up", async () => {
    await wait(50);
    expect(layer().hasAttribute("data-open")).toBe(true);
    popoverCalls.length = 0;
    const dialog = await openDialog();
    expect(popoverCalls).toEqual([]);
    expect(holder().parentElement).toBe(document.body);
    dialog.removeAttribute("open");
    await wait(50);
    expect(popoverCalls).toEqual([]);
    dialog.remove();
  });

  it("puts a toast over the dialog, whether it was up first or came after", async () => {
    await wait(50);
    act(() => { toast.error("Could not save"); });
    await wait(50);
    const first = await openDialog();
    expect(holder().parentElement).toBe(first);
    expect(layer().hasAttribute("data-open")).toBe(true);
    act(() => toast.dismiss());
    await wait(500);
    first.removeAttribute("open");
    await wait(50);
    expect(holder().parentElement).toBe(document.body);
    expect(layer().hasAttribute("data-open")).toBe(true);
    first.remove();

    const second = await openDialog();
    expect(holder().parentElement).toBe(document.body);
    act(() => { toast.error("Could not save again"); });
    await wait(50);
    expect(holder().parentElement).toBe(second);
    expect(layer().hasAttribute("data-open")).toBe(true);
    expect(toasts().find((t) => textOf(t) === "Could not save again")?.closest("dialog")).toBe(second);
    second.remove();
  });
});
