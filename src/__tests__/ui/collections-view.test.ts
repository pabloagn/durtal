// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CollectionsView, CollectionsViewSwitcher } from "@/components/collections/collections-view";
import { COL_CLASSES } from "@/components/shared/grid-columns";
import { LIST_PREFERENCES } from "@/lib/preferences";

// SLN-439 review: the collections list has the size slider, and the slider
// beside the search sets the list below, in the grid and in the mosaic.

vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => createElement("a", props, children as never),
}));
vi.mock("@/components/media/image-adjustment-editor", () => ({ ImageAdjustButton: () => null }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root;
let host: HTMLElement;
beforeEach(() => {
  for (const c of document.cookie.split(";")) document.cookie = `${c.split("=")[0].trim()}=; max-age=0; path=/`;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const collections = ["Gothic", "Decadents", "Symbolists"].map((name, i) => ({
  collection: { id: `c${i}`, name, editionCount: i + 1 },
  covers: [],
}));

function render() {
  act(() =>
    root.render(
      createElement(Fragment, null, createElement(CollectionsViewSwitcher), createElement(CollectionsView, { collections })),
    ),
  );
}

function slide(value: number) {
  const range = host.querySelector("input[type=range]") as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(range, String(value));
    range.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function view(label: string) {
  const button = host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
  act(() => button.click());
}

describe("collections view", () => {
  it("keeps its size like the other lists", () => {
    expect(LIST_PREFERENCES.collections.grid.key).toBe("durtal-collections-grid-columns");
  });

  it("sets the grid's columns from the slider", () => {
    render();
    slide(3);
    const grid = host.querySelector("[class*='grid-cols']") as HTMLElement;
    expect(grid.className).toContain(COL_CLASSES[3]);
    slide(7);
    expect((host.querySelector("[class*='grid-cols']") as HTMLElement).className).toContain(COL_CLASSES[7]);
  });

  it("sets the mosaic's pictures per row from the same slider", () => {
    render();
    view("Mosaic");
    slide(2);
    const mosaic = () => host.querySelector(".mosaic") as HTMLElement;
    expect(mosaic().style.getPropertyValue("--mosaic-per-row")).toBe("4");
    slide(8);
    expect(mosaic().style.getPropertyValue("--mosaic-per-row")).toBe("10");
    expect(mosaic().querySelectorAll("a.mosaic-tile").length).toBe(3);
  });
});
