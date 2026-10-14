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
const render = (visible: boolean, percent: number | null, extra: Partial<Parameters<typeof ReaderBottomBar>[0]> = {}) =>
  act(() => root.render(h(ReaderBridgeProvider, {
    context, plugins: [],
    children: (bridge) => h(ReaderBottomBar, { visible, chapter: "Chapter I", percent, bridge, ...extra }),
  })));
const quiet = () => host.querySelector<HTMLElement>("[data-reader-quiet-chapter]");
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
  it("keeps the chapter in a slim band in the page's colours where no running lines name it", () => {
    const quietBand = { background: "#ecebe6", text: "#1e2120", topFade: false };
    render(false, 44, { quiet: quietBand, onScrub: () => {} });
    expect(quiet()?.textContent).toBe("Chapter I");
    expect(quiet()?.getAttribute("aria-hidden")).toBe("true");
    expect(quiet()?.className).not.toContain("opacity-0");
    expect(quiet()?.style.background).toContain("#ecebe6");
    expect(host.querySelector("[data-reader-top-fade]")).toBeNull();
    render(true, 44, { quiet: quietBand, onScrub: () => {} });
    expect(quiet()?.className).toContain("opacity-0");
    render(false, 44, { quiet: null, onScrub: () => {} });
    expect(quiet()).toBeNull();
    render(false, 44, { quiet: quietBand, chapter: null, onScrub: () => {} });
    expect(quiet()).toBeNull();
  });
  it("fades scrolled text into the top edge", () => {
    render(false, 44, { quiet: { background: "#07090d", text: "#c5cacb", topFade: true } });
    expect(host.querySelector<HTMLElement>("[data-reader-top-fade]")?.style.background).toContain("#07090d");
  });
  it("lays the bar's second row out before the book's positions are ready", () => {
    render(true, null, { onScrub: () => {} });
    const rows = host.querySelector("footer")!.children;
    expect(rows).toHaveLength(2);
    expect(rows[1].className).toContain("min-h-8");
    expect(rows[1].childElementCount).toBe(0);
  });
});
