// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChartFrame } from "@/components/reading/charts/chart-frame";

let host: HTMLDivElement;
let root: Root;
const points = [{ text: "1826: 9 books" }, { text: "1827: 9 books" }, { text: "2025: 8 books" }];
const longSummary = "Books by the year they were written, 1826 to 2025, including books with a very long description and " + "unbroken".repeat(20);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const summary = "Books by year: 1826: 9 books; 1827: 9 books; 2025: 8 books";

function render(brief: string | undefined, step = 1, title?: string) {
  act(() => root.render(h(ChartFrame, {
    label: "Books by year", title, brief, points, step, height: 168,
    table: { columns: ["Year", "Books"], rows: [[1826, 9], [1827, 9], [2025, 8]] },
    children: () => null,
  })));
  return {
    figure: host.querySelector<HTMLElement>("figure")!,
    frame: host.querySelector<HTMLElement>("[data-chart-frame]")!,
    caption: host.querySelector<HTMLElement>("[data-chart-caption]")!,
    live: host.querySelector<HTMLElement>("[data-chart-live]")!,
    toggle: host.querySelector<HTMLButtonElement>("[data-chart-table-toggle]")!,
  };
}
function key(target: HTMLElement, value: string) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  act(() => target.dispatchEvent(event));
  return event;
}

// Happy DOM has no layout engine. This covers the real focus/blur and click
// sequence without inventing rectangles; production browser checks must still
// prove the toggle's bounds stay fixed while the caption wraps.
describe("chart caption and table activation", () => {
  it.each(["Books by year", longSummary, ""])("keeps the blur caption and first pointer activation intact: %s", brief => {
    const { frame, caption, live, toggle } = render(brief);
    act(() => frame.focus());
    for (const value of ["Home", "ArrowRight", "End"])
      expect(key(frame, value).defaultPrevented).toBe(true);
    expect(caption.textContent).toBe("2025: 8 books");
    expect(live.textContent).toBe("2025: 8 books");
    expect(frame.getAttribute("aria-describedby")).toBe(caption.id);

    const down = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    act(() => {
      toggle.dispatchEvent(down);
      toggle.focus();
    });
    // Blur must run before pointer-up: no event suppression or caption delay
    // may hide the transition that originally moved the button.
    expect(down.defaultPrevented).toBe(false);
    expect(caption.textContent).toBe(brief);
    expect(live.textContent).toBe("2025: 8 books");
    expect(host.querySelector("[data-chart-table-toggle]")).toBe(toggle);
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      toggle.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      toggle.click();
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)?.hidden).toBe(false);
    expect([...host.querySelectorAll("th")].map(cell => cell.textContent)).toEqual(["Year", "Books"]);
    expect([...host.querySelectorAll("tbody tr")].map(row => [...row.querySelectorAll("td")].map(cell => cell.textContent)))
      .toEqual([["1,826", "9"], ["1,827", "9"], ["2,025", "8"]]);
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector("[data-chart-table]")).toBeNull();
    expect(caption.textContent).toBe(brief);
  });

  it("preserves step navigation, boundaries and the last live announcement on blur", () => {
    const { frame, caption, live, toggle } = render(longSummary, 2);
    act(() => frame.focus());
    key(frame, "Home");
    expect(caption.textContent).toBe(points[0].text);
    key(frame, "ArrowDown");
    expect(caption.textContent).toBe(points[2].text);
    key(frame, "ArrowUp");
    expect(caption.textContent).toBe(points[0].text);
    expect(key(frame, "Tab").defaultPrevented).toBe(false);
    act(() => toggle.focus());
    expect(caption.textContent).toBe(longSummary);
    expect(live.textContent).toBe(points[0].text);
  });

  it("says the summary once, on the SVG: the caption shows the brief or the label, and the title names the figure (SLN-1172)", () => {
    let { figure, caption } = render(undefined);
    expect(caption.textContent).toBe("Books by year");
    expect(figure.getAttribute("aria-label")).toBe("Books by year");
    expect(host.querySelector("[data-chart-title]")).toBeNull();
    expect(host.textContent).not.toContain(summary);
    ({ figure, caption } = render("23 books in all", 1, "Books finished"));
    const title = host.querySelector<HTMLElement>("[data-chart-title]")!;
    expect(title.textContent).toBe("Books finished");
    expect(figure.getAttribute("aria-labelledby")).toBe(title.id);
    expect(figure.hasAttribute("aria-label")).toBe(false);
    expect(caption.textContent).toBe("23 books in all");
  });
});
