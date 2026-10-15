// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SectionRail } from "@/components/shared/section-rail";

/* The dashboard's section rail (SLN-740): which section it marks, what a name does */

const SECTIONS = [
  { id: "reading", label: "Reading" },
  { id: "recent", label: "Recent additions" },
  { id: "collections", label: "Collections" },
];

let host: HTMLDivElement;
let root: Root;
/** Each section's top in the window, as the page has scrolled */
let tops: Record<string, number>;

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
  vi.stubGlobal("innerHeight", 1000);
  tops = { reading: 400, recent: 1400, collections: 2400 };
  for (const { id } of SECTIONS) {
    const section = document.createElement("section");
    section.id = id;
    section.tabIndex = -1;
    section.getBoundingClientRect = () => ({ top: tops[id] }) as DOMRect;
    section.scrollIntoView = vi.fn();
    document.body.append(section);
  }
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 5000 });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function render(sections = SECTIONS) {
  act(() => root.render(createElement(SectionRail, { sections, label: "Dashboard sections" })));
}

function scrollTo(next: Record<string, number>) {
  tops = next;
  act(() => { window.dispatchEvent(new Event("scroll")); });
}

const ticks = () => [...host.querySelectorAll("[data-rail-tick]")].map((tick) => tick.getAttribute("data-rail-tick"));
const current = () => host.querySelector('[aria-current="location"]')?.textContent;

describe("the section rail", () => {
  it("draws nothing for fewer than three sections", () => {
    render(SECTIONS.slice(0, 2));
    expect(host.innerHTML).toBe("");
  });

  it("marks the first section ahead above it, and keeps the touch button away from the title", () => {
    render();
    expect(ticks()).toEqual(["current", "ahead", "ahead"]);
    expect(current()).toBe("Reading");
    expect(host.querySelector("[data-section-rail-touch]")).toBeNull();
  });

  it("marks the section whose top passed the reading line, and those before it as passed", () => {
    render();
    scrollTo({ reading: -900, recent: 100, collections: 1100 });
    expect(ticks()).toEqual(["passed", "current", "ahead"]);
    expect(current()).toBe("Recent additions");
    expect(host.querySelector("[data-section-rail-touch] button")?.textContent).toBe("2/3Recent additions");
  });

  it("marks the last section at the foot of the page, however short", () => {
    render();
    vi.stubGlobal("scrollY", 4000);
    scrollTo({ reading: -3600, recent: -2600, collections: 800 });
    expect(current()).toBe("Collections");
  });

  it("scrolls to a section's name and moves the focus there", () => {
    render();
    const link = [...host.querySelectorAll("a")].find((a) => a.textContent === "Collections")!;
    expect(link.getAttribute("href")).toBe("#collections");
    act(() => link.click());
    const section = document.getElementById("collections")!;
    expect(section.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    expect(document.activeElement).toBe(section);
  });
});

describe("the dashboard's sections", () => {
  it("each have an id, a scroll margin and take the focus, for the rail", () => {
    const source = readFileSync(join(process.cwd(), "src/app/(catalogue)/page.tsx"), "utf8");
    expect(source).toMatch(/<section id=\{id\} tabIndex=\{-1\}[^>]*scroll-mt-/);
    expect(source).toContain("<SectionRail");
  });
});
