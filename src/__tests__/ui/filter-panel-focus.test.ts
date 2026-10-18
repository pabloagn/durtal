// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FilterDropdown, type AnyFilterGroup } from "@/components/shared/filter-dropdown";

// The hover and focus survey, items 1 to 3 (SLN-870): the shared Filter
// panel's options showed no focus, Tab left it open over the page, and its
// section tabs had their rings cut by their scroller.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const groups: AnyFilterGroup[] = [
  { key: "status", label: "Status", section: "Catalogue", options: [{ value: "a", label: "Accessioned" }, { value: "w", label: "Wanted" }] },
  { key: "lang", label: "Language", section: "Edition", options: [{ value: "fr", label: "French" }] },
];

function render(withSections = false) {
  act(() =>
    root.render(
      h(
        "div",
        null,
        h(FilterDropdown, {
          groups: withSections ? groups : groups.map(({ section: _s, ...g }) => g),
          sections: withSections ? ["Catalogue", "Edition"] : undefined,
          activeFilters: {},
          onFilterChange: () => {},
          onClearAll: () => {},
        }),
        h("button", { type: "button" }, "Export"),
      ),
    ),
  );
}
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text))!;
const open = () => host.querySelectorAll("label").length > 0;
const focus = (el: HTMLElement) => act(() => el.focus());

describe("the Filter panel and the keyboard", () => {
  it("closes when the focus leaves it, as a menu does", () => {
    render();
    act(() => button("Filter").click());
    expect(open()).toBe(true);
    const boxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    focus(boxes[0]);
    focus(boxes[1]);
    expect(open()).toBe(true);
    focus(button("Export"));
    expect(open()).toBe(false);
  });

  it("shows an option's focus on its label, inside the panel's scroller", () => {
    render();
    act(() => button("Filter").click());
    const label = host.querySelector("label")!;
    for (const c of ["has-[:focus-visible]:outline-2", "has-[:focus-visible]:outline-accent-primary", "has-[:focus-visible]:-outline-offset-2"])
      expect(label.className).toContain(c);
  });

  it("draws a section tab's ring inside the tab", () => {
    render(true);
    act(() => button("Filter").click());
    const tabs = host.querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(2);
    for (const tab of tabs) expect(tab.className).toContain("focus-visible:-outline-offset-2");
  });
});
