// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FilterDropdown, type AnyFilterGroup } from "@/components/shared/filter-dropdown";
import { ActiveFilters } from "@/components/shared/active-filters";

// The library's filter panel by sections, its colour swatches and the chips
// of the active filters (SLN-405)

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

const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click());
const button = (text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text)) ?? null;
const tabs = () => [...host.querySelectorAll("[role=tab]")].map((t) => t.textContent);
const groupNames = () => [...host.querySelectorAll("[role=tabpanel] .type-caption")].map((c) => c.textContent);

describe("FilterDropdown with sections", () => {
  const groups: AnyFilterGroup[] = [
    { section: "Collection", key: "status", label: "Status", options: [{ value: "wanted", label: "Wanted" }] },
    { section: "Book", key: "lang", label: "Language", options: [{ value: "fr", label: "French", count: 1204 }] },
    {
      section: "Cover",
      key: "color",
      label: "Colour",
      swatches: true,
      options: [
        { value: "red", label: "Red", swatch: "#a23b3b", count: 3 },
        { value: "pink", label: "Pink", swatch: "#c07a96", count: 0 },
      ],
    },
    { type: "range", section: "Book", key: "published", label: "First published", min: 1600, max: 2000, onChange: () => {}, active: true },
  ];
  const render = (props: Partial<Parameters<typeof FilterDropdown>[0]> = {}) =>
    act(() =>
      root.render(
        createElement(FilterDropdown, {
          groups,
          sections: ["Collection", "Book", "Cover"],
          activeFilters: {},
          onFilterChange: () => {},
          onClearAll: () => {},
          ...props,
        }),
      ),
    );

  it("shows one section at a time, opening on the first with a chosen value", () => {
    render({ activeFilters: { lang: ["fr"] }, activeRangeCount: 1 });
    click(button("Filter"));
    // Book: the language and the range
    expect(tabs()).toEqual(["Collection", "Book2", "Cover"]);
    expect(host.querySelector("[role=tab][aria-selected=true]")?.textContent).toBe("Book2");
    expect(groupNames()).toEqual(["Language", "First published"]);
    expect(host.querySelector("[role=tabpanel] label")?.textContent).toBe("French1,204");
    click([...host.querySelectorAll("[role=tab]")].find((t) => t.textContent === "Collection"));
    expect(groupNames()).toEqual(["Status"]);
  });

  it("lists colours as swatches; a colour no cover has cannot be chosen", () => {
    const onFilterChange = vi.fn();
    render({ onFilterChange });
    click(button("Filter"));
    click([...host.querySelectorAll("[role=tab]")].find((t) => t.textContent === "Cover"));
    const inputs = [...host.querySelectorAll<HTMLInputElement>("[role=tabpanel] input[type=checkbox]")];
    expect(inputs.map((i) => i.disabled)).toEqual([false, true]);
    act(() => inputs[0].click());
    expect(onFilterChange).toHaveBeenCalledWith("color", ["red"]);
  });
});

describe("ActiveFilters", () => {
  it("shows a chip per filter; a chip removes its filter, Clear all every one", () => {
    const onRemove = vi.fn();
    const onClearAll = vi.fn();
    const chips = [
      { key: "lang", value: "fr", group: "Language", label: "French" },
      { key: "color", value: "red", group: "Colour", label: "Red", swatch: "#a23b3b" },
    ];
    act(() => root.render(createElement(ActiveFilters, { chips, onRemove, onClearAll })));
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([
      "Remove filter: Language French",
      "Remove filter: Colour Red",
      "Clear all",
    ]);
    click(buttons[1]);
    expect(onRemove).toHaveBeenCalledWith(chips[1]);
    click(buttons[2]);
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("shows nothing without a filter", () => {
    act(() => root.render(createElement(ActiveFilters, { chips: [], onRemove: () => {}, onClearAll: () => {} })));
    expect(host.innerHTML).toBe("");
  });
});
