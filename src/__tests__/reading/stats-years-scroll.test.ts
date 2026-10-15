// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StatsYears } from "@/components/reading/stats-years";

// Review of #375: choosing one of the last years scrolled the row only as
// far as it goes, so it began partway through a year (18px off at 320 in
// WebKit). The row now begins on a whole year, with the chosen one in view.
const ROW = 290, STEP = 60, CHIP = 56;
const years = [{ label: "All time", href: "/reading/stats?year=all", current: false },
  ...Array.from({ length: 32 }, (_, i) => ({ label: String(2026 - i), href: `/reading/stats?year=${2026 - i}`, current: i === 31 }))];

// happy-dom has no layout: give the row and its chips the boxes a browser would
function laidOut(ul: HTMLElement) {
  let left = 0;
  const extra = () => parseFloat(ul.style.paddingInlineEnd || "0") || 0;
  const scrollWidth = () => years.length * STEP - (STEP - CHIP) + extra();
  Object.defineProperty(ul, "clientWidth", { get: () => ROW });
  Object.defineProperty(ul, "scrollWidth", { get: scrollWidth });
  Object.defineProperty(ul, "scrollLeft", {
    get: () => left,
    set: (value: number) => { left = Math.max(0, Math.min(value, scrollWidth() - ROW)); },
  });
  ul.getBoundingClientRect = () => ({ left: 0, right: ROW, width: ROW, top: 0, bottom: 28, height: 28, x: 0, y: 0, toJSON() {} });
}
function chipBox(this: HTMLElement) {
  const ul = this.closest("ul")!, index = [...ul.querySelectorAll("a")].indexOf(this as HTMLAnchorElement);
  const left = index * STEP - ul.scrollLeft;
  return { left, right: left + CHIP, width: CHIP, top: 0, bottom: 28, height: 28, x: left, y: 0, toJSON() {} };
}

let root: Root | null = null, host: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); vi.restoreAllMocks(); });

it("begins on a whole year when the chosen year is one of the last", () => {
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string, options?: ElementCreationOptions) => {
    const element = create(tag, options);
    if (tag === "ul") laidOut(element);
    if (tag === "a") element.getBoundingClientRect = chipBox as () => DOMRect;
    return element;
  }) as typeof document.createElement);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root!.render(createElement(StatsYears, { years })));
  const ul = host.querySelector<HTMLElement>("[data-stats-years]")!;
  const chosen = host.querySelector<HTMLElement>('[aria-current="page"]')!;
  expect(chosen.textContent).toBe("1995");
  const boxes = [...host.querySelectorAll("a")].map((a) => a.getBoundingClientRect());
  // No year cut at the row's start, the first one shown on its edge
  expect(boxes.filter((b) => b.left < 0 && b.right > 0)).toEqual([]);
  expect(boxes.find((b) => b.right > 0)!.left).toBe(0);
  // and the chosen year whole in view
  expect(chosen.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
  expect(chosen.getBoundingClientRect().right).toBeLessThanOrEqual(ROW);
  expect(ul.scrollLeft % STEP).toBe(0);
});
