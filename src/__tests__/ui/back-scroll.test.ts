// @vitest-environment happy-dom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackScroll } from "@/components/shared/back-scroll";

let host: HTMLDivElement;
let root: Root;
let y = 0;
const scrollTo = vi.fn((_x: number, to: number) => { y = to; });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  y = 0;
  vi.spyOn(window, "scrollY", "get").mockImplementation(() => y);
  vi.stubGlobal("scrollTo", scrollTo);
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  scrollTo.mockClear();
});

const list = "/ebooks/highlights?page=2";
const show = (href: string) => act(async () => root.render(h(BackScroll, { href })));

describe("Back to the highlights lands where the reader left (SLN-933)", () => {
  it("keeps the place on the click that leaves, and goes back to it after Back", async () => {
    history.replaceState(null, "", list);
    await show(list);
    y = 1400;
    document.body.click();
    // One book's marks: a shorter page, the browser clamps the scroll
    history.pushState(null, "", "/ebooks/highlights?ebook=x");
    await show("/ebooks/highlights?ebook=x");
    y = 981;
    history.replaceState(null, "", list);
    window.dispatchEvent(new PopStateEvent("popstate"));
    await show(list);
    expect(scrollTo).toHaveBeenLastCalledWith(0, 1400);
    expect(y).toBe(1400);
  });

  it("leaves the scroll alone on a link or a filter, without Back", async () => {
    history.replaceState(null, "", list);
    await show(list);
    y = 1400;
    document.body.click();
    await show("/ebooks/highlights?ebook=x");
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.spyOn(performance, "now").mockReturnValue(performance.now() + 5000);
    await show(list);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
