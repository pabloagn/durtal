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

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // happy-dom knows neither :focus-visible nor the popover API: every focus
  // here comes from the keyboard, and the popover is a flag.
  const matches = Element.prototype.matches;
  Element.prototype.matches = function (selector: string) {
    if (selector === ":focus-visible") return this === document.activeElement;
    if (selector === ":popover-open") return this.hasAttribute("data-open");
    return matches.call(this, selector);
  };
  HTMLElement.prototype.showPopover = function () {
    this.setAttribute("data-open", "");
  };
  HTMLElement.prototype.hidePopover = function () {
    this.removeAttribute("data-open");
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
});
