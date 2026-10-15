// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipLayer } from "@/components/ui/tooltip";

// A ranking's title cut to one line shows in full on keyboard focus of its
// link, as it does on hover (SLN-641 piece 9), so a keyboard reader can read it.

let root: Root;
let host: HTMLElement;
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const tooltip = () => document.getElementById("app-tooltip");

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // happy-dom knows neither :focus-visible nor the popover API, nor layout:
  // every focus here comes from the keyboard, and the popover is a flag
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
  act(() => root.render(createElement(TooltipLayer)));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.querySelectorAll("[data-probe]").forEach((el) => el.remove());
});

/** A ranking row: a link holding a one-line title, cut or not */
function row(title: string, cut: boolean) {
  const link = document.createElement("a");
  link.href = "/library/a-book";
  link.dataset.probe = "";
  const text = document.createElement("span");
  text.className = "lines-1";
  text.style.textOverflow = "ellipsis";
  text.textContent = title;
  Object.defineProperty(text, "scrollWidth", { value: cut ? 600 : 100 });
  Object.defineProperty(text, "clientWidth", { value: 100 });
  link.append(text);
  document.body.append(link);
  return link;
}

it("shows a cut title in full when its link takes keyboard focus", async () => {
  const title = "Ada or Ardor: A Family Chronicle, Being the Complete and Unabridged Text";
  const link = row(title, true);
  act(() => link.focus());
  await wait(20);
  expect(tooltip()?.hasAttribute("data-open")).toBe(true);
  expect(tooltip()?.textContent).toBe(title);
  // The focused link is the anchor, so the tooltip closes when focus leaves
  act(() => link.blur());
  await wait(20);
  expect(tooltip()?.hasAttribute("data-open")).toBe(false);
});

it("shows nothing for a title that fits", async () => {
  const link = row("Ada", false);
  act(() => link.focus());
  await wait(20);
  expect(tooltip()?.hasAttribute("data-open")).toBe(false);
});

it("keeps a fact's full text when focus nudges its cut line", async () => {
  // Stats facts: the link sits in a one-line value with its day count
  const title = "Against Nature, or À Rebours: The Complete Decadent Breviary";
  const value = document.createElement("dd");
  value.className = "lines-1";
  value.dataset.probe = "";
  value.style.textOverflow = "ellipsis";
  Object.defineProperty(value, "scrollWidth", { value: 600 });
  Object.defineProperty(value, "clientWidth", { value: 100 });
  const link = document.createElement("a");
  link.href = "/library/a-book";
  link.textContent = title;
  value.append(link, " · 20 days from start to finish");
  document.body.append(value);
  act(() => link.focus());
  // The browser scrolls the clipped line to show the focused link
  act(() => void value.dispatchEvent(new Event("scroll")));
  await wait(20);
  expect(tooltip()?.hasAttribute("data-open")).toBe(true);
  expect(tooltip()?.textContent).toContain(title);
  // A real scroll still closes it
  act(() => void document.dispatchEvent(new Event("scroll")));
  await wait(20);
  expect(tooltip()?.hasAttribute("data-open")).toBe(false);
});
