// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WrittenChart } from "@/components/statistics/written-chart";
import { compactYearCounts } from "@/lib/statistics/charts";

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 600, height: 168, top: 0, left: 0, right: 600, bottom: 168,
    x: 0, y: 0, toJSON: () => ({}),
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const click = (button: Element | null) => act(() => (button as HTMLButtonElement).click());
const tableRows = () => Array.from(host.querySelectorAll("tbody tr"), (row) =>
  Array.from(row.querySelectorAll("td"), (cell) => cell.textContent));
const axis = () => Array.from(host.querySelectorAll("svg text"), (label) => label.textContent);
const key = (value: string) => act(() => host.querySelector("[data-chart-frame]")!.dispatchEvent(
  new KeyboardEvent("keydown", { key: value, bubbles: true })));

describe("written chart with compact server data", () => {
  it("keeps rendered year/decade labels, counts, empty points and the earlier-years footnote", () => {
    const years = compactYearCounts([
      { year: -800, count: 1 }, { year: 1857, count: 2 }, { year: 1884, count: 3 },
      { year: 1957, count: 4 }, { year: 2026, count: 1 },
    ]);
    act(() => root.render(createElement(WrittenChart, { years })));
    expect(axis()).toEqual(["1827", "2026"]);
    expect(host.querySelector("svg")?.getAttribute("aria-label"))
      .toBe("Books by the year they were written, 1827 to 2026");
    expect(host.querySelectorAll("[data-tooltip]")).toHaveLength(200);
    expect(host.textContent).toContain("1 book written before 1827 is in the Decades view.");
    click(host.querySelector("[data-chart-table-toggle]"));
    expect(Array.from(host.querySelectorAll("th"), (cell) => cell.textContent)).toEqual(["Year", "Books"]);
    expect(tableRows()).toEqual([["1857", "2"], ["1884", "3"], ["1957", "4"], ["2026", "1"]]);
    key("Home");
    expect(host.querySelector("[data-chart-caption]")?.textContent).toBe("1827: 0 books");
    key("End");
    expect(host.querySelector("[data-chart-live]")?.textContent).toBe("2026: 1 book");

    click(Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Decades")!);
    expect(axis()).toEqual(["Before 1850", "2020s"]);
    expect(host.querySelector("svg")?.getAttribute("aria-label"))
      .toBe("Books by the decade they were written, Before 1850 to 2020s");
    expect(host.querySelectorAll("[data-tooltip]")).toHaveLength(19);
    expect(host.textContent).not.toContain("written before 1827");
    click(host.querySelector("[data-chart-table-toggle]"));
    expect(Array.from(host.querySelectorAll("th"), (cell) => cell.textContent)).toEqual(["Decade", "Books"]);
    expect(tableRows()).toEqual([
      ["Before 1850", "1"], ["1850s", "2"], ["1880s", "3"], ["1950s", "4"], ["2020s", "1"],
    ]);
    key("Home");
    expect(host.querySelector("[data-chart-live]")?.textContent).toBe("Before 1850: 1 book");
    key("End");
    expect(host.querySelector("[data-chart-caption]")?.textContent).toBe("The 2020s: 1 book");
  });

  it("renders nothing for an empty catalogue", () => {
    act(() => root.render(createElement(WrittenChart, { years: [] })));
    expect(host.innerHTML).toBe("");
  });
});
