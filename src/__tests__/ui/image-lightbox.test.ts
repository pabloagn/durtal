// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ImageLightbox } from "@/components/shared/image-lightbox";
import { CoarseImageSource } from "@/components/shared/coarse-image-source";
import { WorkPosterImage } from "@/app/library/[slug]/work-poster-image";

vi.mock("@/components/media/image-adjustment-editor", () => ({
  ImageAdjustButton: ({ source }: { source: string }) =>
    createElement("button", {
      "aria-label": "Adjust image",
      "data-source": source,
    }),
}));
vi.mock("@/app/library/[slug]/ambient-crystals", () => ({
  PosterGlow: () => null,
}));
beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.style.overflow = "";
});
const source = "/api/s3/read?key=gold%2Fmedia%2Fposter.webp&v=123";
const crop = { x: 25, y: 65, zoom: 110, brightness: 90, contrast: 105 };
function renderPoster(src = source) {
  act(() =>
    root.render(
      createElement(WorkPosterImage, { src, alt: "Fixture poster", crop }),
    ),
  );
}
function open() {
  const trigger = host.querySelector('[role="button"]') as HTMLElement;
  trigger.focus();
  act(() => trigger.click());
  return document.querySelector('[role="dialog"]') as HTMLElement;
}

describe("coarse poster source selection", () => {
  it("emits the native bounded source before the canonical image, preserving crop and adjustment identity", () => {
    renderPoster();
    const picture = host.querySelector("picture")!;
    const bounded = picture.querySelector("source")!;
    const img = picture.querySelector("img")!;
    expect(picture.firstElementChild).toBe(bounded);
    expect(bounded.media).toBe("(pointer: coarse)");
    expect(
      new URL(bounded.srcset, "https://fixture.invalid").searchParams.get("w"),
    ).toBe("800");
    expect(
      new URL(bounded.srcset, "https://fixture.invalid").searchParams.get("v"),
    ).toBe("123");
    expect(img.getAttribute("src")).toBe(source);
    expect(img.style.objectPosition).toBe("25% 65%");
    expect(img.style.transform).toBe("scale(1.1)");
    const dialog = open();
    expect(dialog.querySelector("img")!.getAttribute("src")).toBe(source);
    expect(
      dialog
        .querySelector('[aria-label="Adjust image"]')!
        .getAttribute("data-source"),
    ).toBe(source);
    expect(dialog.querySelector("picture source")!.getAttribute("srcset")).toBe(
      bounded.srcset,
    );
  });

  it.each([
    "https://images.example/portrait.jpg?v=1",
    "//images.example/portrait.jpg",
    "/other/image.jpg",
    "",
  ])("leaves external or absent image sources alone: %s", (src) => {
    expect(
      renderToStaticMarkup(createElement(CoarseImageSource, { src })),
    ).toBe("");
  });

  it("does not mount an absent/closed lightbox or request its image", () => {
    act(() =>
      root.render(
        createElement(ImageLightbox, {
          src: source,
          alt: "Fixture",
          open: false,
          onClose: () => {},
        }),
      ),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector("img")).toBeNull();
  });
});

describe("lightbox loading and exit", () => {
  it("provides a stable loading/error frame and restores previous scroll/focus on close", () => {
    document.body.style.overflow = "clip";
    renderPoster();
    const trigger = host.querySelector('[role="button"]') as HTMLElement;
    const dialog = open();
    const frame = dialog.querySelector("[aria-busy]")!;
    expect(frame.getAttribute("aria-busy")).toBe("true");
    expect(dialog.querySelector('[role="status"]')!.textContent).toContain(
      "Loading image",
    );
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(
      dialog.querySelector('[aria-label="Close image"]'),
    );
    act(() => dialog.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(frame.getAttribute("aria-busy")).toBe("false");
    expect(dialog.querySelector('[role="alert"]')!.textContent).toBe(
      "Could not load this image.",
    );
    expect(
      (dialog.querySelector("img") as HTMLImageElement).style.visibility,
    ).toBe("hidden");
    act(() =>
      (
        dialog.querySelector('[aria-label="Close image"]') as HTMLButtonElement
      ).click(),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe("clip");
    expect(document.activeElement).toBe(trigger);
  });

  it("reveals a loaded image and resets loading on each new open; Escape remains usable", () => {
    renderPoster();
    for (let cycle = 0; cycle < 3; cycle++) {
      const dialog = open();
      expect(dialog.querySelector('[role="status"]')).not.toBeNull();
      act(() => dialog.querySelector("img")!.dispatchEvent(new Event("load")));
      expect(
        dialog.querySelector("[aria-busy]")!.getAttribute("aria-busy"),
      ).toBe("false");
      expect(
        (dialog.querySelector("img") as HTMLImageElement).style.visibility,
      ).toBe("visible");
      act(() =>
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
      );
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    }
  });

  it("keeps keyboard focus inside the viewer while nested native dialogs retain Escape", () => {
    function Fixture() {
      const [opened, setOpened] = useState(true);
      return createElement(ImageLightbox, {
        src: source,
        alt: "Fixture",
        open: opened,
        onClose: () => setOpened(false),
      });
    }
    act(() => root.render(createElement(Fixture)));
    const dialog = document.querySelector('[role="dialog"]')!;
    const adjust = dialog.querySelector(
      '[aria-label="Adjust image"]',
    ) as HTMLButtonElement;
    const close = dialog.querySelector(
      '[aria-label="Close image"]',
    ) as HTMLButtonElement;
    act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", cancelable: true }),
      ),
    );
    expect(document.activeElement).toBe(adjust);
    act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(close);
    const nested = document.createElement("dialog");
    nested.setAttribute("open", "");
    document.body.append(nested);
    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    nested.remove();
  });
});
