// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReaderBridgeProvider } from "@/components/reader/bridge";
import { ReaderBottomBar } from "@/components/reader/reader-bottom-bar";

let root: Root, host: HTMLElement;
const context = { ebookId: "book", fileId: "epub", format: "epub" as const, locator: null, percent: null, chapter: null, selection: null };
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = (visible: boolean, percent: number | null) =>
  act(() => root.render(h(ReaderBridgeProvider, {
    context, plugins: [],
    children: (bridge) => h(ReaderBottomBar, { visible, chapter: "Chapter I", percent, bridge }),
  })));
const line = () => host.querySelector<HTMLElement>("[data-reader-progress-line]");

describe("the reader's progress line (SLN-663)", () => {
  it("shows how far you are along the bottom edge while the bars are hidden", () => {
    render(false, 44);
    expect(line()?.className).not.toContain("opacity-0");
    expect(line()?.getAttribute("aria-hidden")).toBe("true");
    expect((line()?.firstElementChild as HTMLElement).style.width).toBe("44%");
    expect(host.querySelector("footer")?.className).toContain("opacity-0");
  });
  it("fades out while the bars are up, and is absent before the book opens", () => {
    render(true, 44);
    expect(line()?.className).toContain("opacity-0");
    render(false, null);
    expect(line()).toBeNull();
  });
});
