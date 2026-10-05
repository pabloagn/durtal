// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Mosaic, mosaicPerRow, type MosaicItem } from "@/components/shared/mosaic";
import { LIST_PREFERENCES } from "@/lib/preferences";

// SLN-439: one mosaic for every list with pictures.

vi.mock("next/link", () => ({
  default: ({ children, ...props }: Record<string, unknown>) => createElement("a", props, children as never),
}));

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

const items: MosaicItem[] = [
  { key: "a", href: "/library/a", title: "Vathek", subtitle: "William Beckford", aspect: 2 / 3, media: createElement("img", { alt: "" }) },
  { key: "b", href: "/paintings/b", title: "The Third of May", aspect: 1.3, media: createElement("img", { alt: "" }) },
];
const tiles = () => [...host.querySelectorAll("a.mosaic-tile")] as HTMLAnchorElement[];

describe("mosaic", () => {
  it("shows each picture as a link in its own proportions, in order, with nothing else", () => {
    act(() => root.render(createElement(Mosaic, { items, perRow: 8, aspect: 2 / 3 })));
    expect(tiles().map((t) => t.getAttribute("href"))).toEqual(["/library/a", "/paintings/b"]);
    expect(tiles().map((t) => t.style.getPropertyValue("--tile-aspect"))).toEqual([String(2 / 3), "1.3"]);
    expect(tiles()[0].getAttribute("aria-label")).toBe("Vathek, William Beckford");
    const row = host.querySelector(".mosaic") as HTMLElement;
    expect(row.style.getPropertyValue("--mosaic-per-row")).toBe("8");
    // The last row's filler, so it keeps its height
    expect(row.lastElementChild?.className).toBe("mosaic-fill");
  });

  it("selects instead of opening while selecting", () => {
    const onSelect = vi.fn();
    act(() => root.render(createElement(Mosaic, { items, perRow: 8, aspect: 2 / 3, isSelecting: true, selectedIds: new Set(["b"]), onSelect })));
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      tiles()[0].dispatchEvent(click);
    });
    expect(onSelect).toHaveBeenCalledWith("a");
    expect(click.defaultPrevented).toBe(true);
    expect(tiles()[1].classList.contains("mosaic-tile-selected")).toBe(true);
    expect(tiles()[1].getAttribute("aria-pressed")).toBe("true");
  });

  it("is denser than the grid: two more per row, from 4 to 10", () => {
    expect([2, 4, 6, 8].map(mosaicPerRow)).toEqual([4, 6, 8, 10]);
  });

  it("is offered by every list with pictures, and kept like the other views", () => {
    for (const list of [LIST_PREFERENCES.library, LIST_PREFERENCES.authors, LIST_PREFERENCES.collections])
      expect(list.view.modes).toContain("mosaic");
  });
});
