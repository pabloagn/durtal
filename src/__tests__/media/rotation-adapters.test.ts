// @vitest-environment happy-dom
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
vi.mock("@/components/media/image-adjustment-editor", () => ({
  ImageAdjustButton: () => null,
}));
vi.mock("next/image", () => ({
  default: ({ priority, unoptimized, ...props }: Record<string, unknown>) => {
    void priority;
    void unoptimized;
    return createElement("img", props);
  },
}));
import { Lightbox } from "@/components/media/lightbox";
import { ImageLightbox } from "@/components/shared/image-lightbox";
import { ImageRotationPreview } from "@/components/media/image-rotation-preview";
let host: HTMLElement, root: Root;
beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
    function (this: HTMLDialogElement) {
      this.open = true;
    },
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
describe("minimal rotation consumers", () => {
  it("keeps the media lightbox's zero image directly in the original sizing container", () => {
    act(() =>
      root.render(
        createElement(Lightbox, {
          images: [{ src: "/image", alt: "Image", caption: "Caption" }],
          initialIndex: 0,
          onClose: () => {},
        }),
      ),
    );
    const image = host.querySelector("img")!;
    expect(image.parentElement?.className).toBe(
      "relative max-h-[90vh] max-w-[90vw]",
    );
    expect(image.className).toBe("max-h-[85vh] w-auto object-contain");
    expect(host.querySelector("[data-image-rotation-frame]")).toBeNull();
  });
  it("allocates a distinct finite nonzero media image slot and bounded wrapping caption", () => {
    act(() =>
      root.render(
        createElement(Lightbox, {
          images: [
            {
              src: "/image",
              alt: "Image",
              caption: "Long caption ".repeat(50),
              rotation: 45,
            },
          ],
          initialIndex: 0,
          onClose: () => {},
        }),
      ),
    );
    const frame = host.querySelector("[data-image-rotation-frame]")!;
    expect(frame.parentElement?.className).toBe("relative min-h-0 flex-1");
    expect(
      (frame.parentElement?.parentElement as HTMLElement).style.height,
    ).toBe("calc(100dvh - 96px)");
    expect(host.querySelector("p")?.className).toContain("max-h-[25dvh]");
  });
  it.each([0, 45])(
    "preserves the shared lightbox's outer animation/protection at %s degrees",
    (rotation) => {
      act(() =>
        root.render(
          createElement(ImageLightbox, {
            src: "/image",
            alt: "Image",
            open: true,
            onClose: () => {},
            rotation,
          }),
        ),
      );
      const parent = document.querySelector<HTMLElement>(
        '[style*="lightbox-scale-in"]',
      )!;
      expect(parent.style.animation).toContain("lightbox-scale-in");
      expect(parent.querySelector("img")?.className).toContain(
        "protected-image",
      );
      if (rotation === 0) {
        expect(parent.querySelector("[data-image-rotation-frame]")).toBeNull();
        expect(parent.querySelector("img")?.parentElement).toBe(parent);
        expect(parent.style.height).toBe("");
      } else expect(parent.style.height).toBe("calc(100dvh - 96px)");
    },
  );
  it("previews an unchanged baked or legacy crop from display and dirty recrop/reset from base", () => {
    const baseline = { x: 30, y: 70, zoom: 140 };
    for (const crop of [
      baseline,
      { x: 0, y: 0, zoom: 200 },
      { x: 50, y: 50, zoom: 100 },
    ]) {
      act(() =>
        root.render(
          createElement(ImageRotationPreview, {
            rotation: 45,
            sources: { display: "/display", preview: "/base" },
            crop,
            baselineCrop: baseline,
            cropAspect: 2 / 3,
            original: createElement("img", { src: "/original" }),
            renderImage: (binding) => createElement("img", binding),
          }),
        ),
      );
      expect(host.querySelector("img")?.getAttribute("src")).toBe(
        crop === baseline ? "/display" : "/base",
      );
    }
  });
});
