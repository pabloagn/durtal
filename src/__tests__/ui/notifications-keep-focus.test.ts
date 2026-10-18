// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { AppToaster } from "@/components/layout/app-toaster";
import { NotificationCentre } from "@/components/layout/notification-centre";
import { getEntries, resetForTests } from "@/lib/notifications/history";

// The settings survey (16 Oct): Remove, Mark all read and Clear all in the
// notifications panel dropped the focus to the page body (SLN-922).

let root: Root;
let host: HTMLElement;
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const matches = Element.prototype.matches;
  Element.prototype.matches = function (selector: string) {
    if (selector === ":popover-open") return this.hasAttribute("data-open");
    return matches.call(this, selector);
  };
});
beforeEach(() => {
  localStorage.clear();
  resetForTests();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => toast.dismiss());
  act(() => root.unmount());
  host.remove();
});

describe("the notifications panel", () => {
  const popover = () => document.querySelector<HTMLElement>("[data-notification-popover]")!;
  const removes = () => [...popover().querySelectorAll<HTMLButtonElement>("[data-notification-remove]")];
  const action = (name: string) => [...popover().querySelectorAll("button")].find((b) => b.textContent?.trim() === name)!;

  async function open(titles: string[]) {
    act(() => root.render(h("div", null, h(NotificationCentre, { className: "" }), h(AppToaster))));
    act(() => titles.forEach((title) => toast.error(title)));
    await wait(50);
    expect(getEntries()).toHaveLength(titles.length);
    act(() => {
      popover().setAttribute("data-open", "");
      popover().dispatchEvent(Object.assign(new Event("toggle"), { newState: "open" }));
    });
  }

  it("hands Remove's focus to the next entry's Remove, then the one before, then the panel", async () => {
    await open(["One", "Two", "Three"]);
    // Newest first: Three, Two, One
    removes()[1].focus();
    act(() => removes()[1].click());
    expect(removes()).toHaveLength(2);
    expect(document.activeElement).toBe(removes()[1]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe('Remove "One"');
    act(() => removes()[1].click());
    expect(document.activeElement).toBe(removes()[0]);
    act(() => removes()[0].click());
    expect(removes()).toHaveLength(0);
    expect(document.activeElement).toBe(popover());
  });

  it("hands Mark all read's focus to Clear all, and Clear all's to the panel", async () => {
    await open(["One", "Two"]);
    const mark = action("Mark all read");
    mark.focus();
    act(() => mark.click());
    expect(document.activeElement).toBe(action("Clear all"));
    act(() => action("Clear all").click());
    expect(getEntries()).toHaveLength(0);
    expect(document.activeElement).toBe(popover());
  });

  it("keeps its two actions on one line each, under a functional heading", async () => {
    await open(["One"]);
    expect(action("Mark all read").className).toContain("whitespace-nowrap");
    expect(action("Clear all").className).toContain("whitespace-nowrap");
    expect(popover().querySelector("h2")?.className).toContain("type-dialog-title");
  });
});
