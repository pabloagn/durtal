// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cwd } from "node:process";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReaderSidePanel } from "@/components/reader/side-panel";
import { ReaderToolbar } from "@/components/reader/reader-toolbar";

let host: HTMLDivElement;
let root: Root;
function setViewport(width: number) {
  vi.stubGlobal("innerWidth", width);
  window.dispatchEvent(new Event("resize"));
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLDialogElement.prototype, "show").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const toolbar = () => h(ReaderToolbar, {
  visible: true, title: "Là-bas", chapter: "Chapter 1", backHref: "/ebooks", onBack: vi.fn(),
  onContents: vi.fn(), onSettings: vi.fn(), onSearch: vi.fn(), fullscreen: false,
  onFullscreen: vi.fn(), onShortcuts: vi.fn(),
});
const render = (settings: boolean, contents = false) => act(async () => root.render(h("div", null,
  toolbar(),
  h(ReaderSidePanel, { open: settings, title: "Reading settings", variant: "settings", onClose: vi.fn(), children: null }),
  h(ReaderSidePanel, { open: contents, title: "Contents", onClose: vi.fn(), children: null }),
)));
const inset = () => {
  const style = document.documentElement.style;
  return [style.getPropertyValue("--reader-inset-left"), style.getPropertyValue("--reader-inset-right")];
};
const more = () => !!host.querySelector('[aria-label="More"]');

describe("the reader's bars beside an open drawer (SLN-892)", () => {
  it("inset with the book from 1024, and keep their controls while there is room", async () => {
    setViewport(1024);
    await render(false);
    expect(inset()).toEqual(["", ""]);
    await render(true);
    expect(inset()).toEqual(["", "360px"]);
    // 664px left beside the drawer: the whole bar still fits
    expect(more()).toBe(false);
    // A drawer on each side leaves the bar 304px: it keeps its main controls
    await render(true, true);
    expect(inset()).toEqual(["360px", "360px"]);
    expect(more()).toBe(true);
    await render(false);
    expect(inset()).toEqual(["", ""]);
    expect(more()).toBe(false);
  });

  it("stay full width below 1024, where the drawer lies over the book", async () => {
    setViewport(1023);
    await render(true);
    expect(inset()).toEqual(["", ""]);
    expect(more()).toBe(false);
  });

  it("are every strip fixed to the screen's edges, all on the same inset; the font rows match", () => {
    const read = (path: string) => readFileSync(resolve(cwd(), path), "utf8");
    const strips = [
      ["src/components/reader/reader-toolbar.tsx", 1],
      ["src/components/reader/reader-bottom-bar.tsx", 4],
      ["src/components/reader/search-panel.tsx", 1],
      ["src/components/reader/speech-player.tsx", 1],
    ] as const;
    for (const [path, count] of strips) {
      const source = read(path);
      expect(source.match(/fixed inset-x-reader/g)?.length ?? 0, path).toBe(count);
      expect(source, path).not.toMatch(/fixed inset-x-0/);
    }
    // The font grid's rows share one height, the two-line "Atkinson Hyperlegible" row too
    expect(read("src/components/reader/font-picker.tsx")).toContain('className="grid auto-rows-fr grid-cols-2 gap-1"');
    expect(read("src/styles/globals.css")).toMatch(
      /@utility inset-x-reader \{\s*left: var\(--reader-inset-left, 0px\);\s*right: var\(--reader-inset-right, 0px\);/,
    );
  });
});
