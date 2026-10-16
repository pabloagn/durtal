// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, expect, it, onTestFinished, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// Broken-images survey (2026-10-15): an image that fails shows what no image
// does (a cover's letter, a person's initials, a bare frame), never the
// browser's broken mark or its alt text; a failure before hydration counts too.

import { FadeImage } from "@/components/shared/fade-image";
import { CoverCells } from "@/components/shared/cover-cells";

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
  vi.restoreAllMocks();
});

const letter = createElement("span", { "data-letter": "" }, "A");

function fail(img: Element) {
  act(() => {
    img.dispatchEvent(new Event("error"));
  });
}

it("shows the fallback in place of a failed image, keeping its alt for a screen reader", () => {
  const onError = vi.fn();
  act(() => root.render(createElement(FadeImage, { src: "/a.webp", alt: "Against Nature", fallback: letter, onError })));
  fail(host.querySelector("img")!);
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector("[data-letter]")?.textContent).toBe("A");
  expect(host.querySelector(".sr-only")?.textContent).toBe("Against Nature");
  expect(onError).toHaveBeenCalledOnce();
});

it("hides a failed image without a fallback, leaving the bare frame", () => {
  act(() => root.render(createElement(FadeImage, { src: "/a.webp", alt: "" })));
  fail(host.querySelector("img")!);
  expect(host.querySelector("img")?.className).toContain("opacity-0");
});

it("draws the image again when its source changes after a failure", () => {
  act(() => root.render(createElement(FadeImage, { src: "/a.webp", alt: "", fallback: letter })));
  fail(host.querySelector("img")!);
  act(() => root.render(createElement(FadeImage, { src: "/b.webp", alt: "", fallback: letter })));
  expect(host.querySelector("img")?.getAttribute("src")).toBe("/b.webp");
  expect(host.querySelector("[data-letter]")).toBeNull();
});

it("catches a failure that came before React listened", async () => {
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);
  const decode = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = () => Promise.reject(new Error("broken"));
  onTestFinished(() => {
    HTMLImageElement.prototype.decode = decode;
  });
  const onError = vi.fn();
  await act(async () => {
    root.render(createElement(FadeImage, { src: "/gone.webp", alt: "", fallback: letter, onError }));
  });
  expect(host.querySelector("[data-letter]")).not.toBeNull();
  expect(onError).toHaveBeenCalledOnce();
});

it("leaves a failed cover's cell blank, and shows the fallback when every one fails", () => {
  act(() =>
    root.render(
      createElement(CoverCells, {
        srcs: ["/1.webp", "/2.webp"],
        className: "grid grid-cols-2",
        cellClassNames: ["h-full", "h-full"],
        fallback: letter,
      }),
    ),
  );
  fail(host.querySelectorAll("img")[0]);
  expect(host.querySelectorAll("img")).toHaveLength(1);
  expect(host.querySelector("span.bg-bg-tertiary")).not.toBeNull();
  fail(host.querySelector("img")!);
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector("[data-letter]")).not.toBeNull();
});
