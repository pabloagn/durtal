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
import {
  ImageRotationFrame,
  type ImageRotationFrameProps,
} from "@/components/media/image-rotation-frame";

let observers: TestObserver[];
class TestObserver {
  target?: Element;
  disconnected = false;
  constructor(private callback: ResizeObserverCallback) {
    observers.push(this);
  }
  observe(target: Element) {
    this.target = target;
  }
  disconnect() {
    this.disconnected = true;
  }
  resize(width: number, height: number) {
    this.callback(
      [
        {
          target: this.target,
          contentRect: { width, height },
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
}
let root: Root;
let host: HTMLElement;
beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  observers = [];
  vi.stubGlobal("ResizeObserver", TestObserver);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const original = createElement("img", {
  src: "/old",
  alt: "Original",
  className: "object-cover",
  style: { transform: "scale(1.4)", objectPosition: "30% 70%" },
});
const base: ImageRotationFrameProps = {
  rotation: 90,
  src: "/current",
  original,
  renderImage: (binding) =>
    createElement("img", {
      ...binding,
      alt: "Rotated",
      draggable: false,
      style: { filter: "grayscale(100%)", ...binding.style },
    }),
};
const render = (props: Partial<ImageRotationFrameProps> = {}) =>
  act(() => {
    root.render(createElement(ImageRotationFrame, { ...base, ...props }));
  });
const load = (width: number, height: number) =>
  act(() => {
    const image = host.querySelector("img")!;
    Object.defineProperties(image, {
      naturalWidth: { configurable: true, value: width },
      naturalHeight: { configurable: true, value: height },
    });
    image.dispatchEvent(new Event("load"));
  });
const selection = () =>
  host.querySelector<HTMLElement>("[data-image-rotation-selection]")!;

describe("React-owned image rotation frame lifecycle", () => {
  it("returns the exact existing image at zero without wrappers, reads or observers", () => {
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");
    const active = vi.fn(base.renderImage);
    render({ rotation: 0, renderImage: active });
    expect(host.children).toHaveLength(1);
    expect(host.firstElementChild?.tagName).toBe("IMG");
    expect(host.querySelector("img")?.getAttribute("style")).toContain(
      "scale(1.4)",
    );
    expect(observers).toHaveLength(0);
    expect(active).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
    measure.mockRestore();
  });
  it("waits for actual image and frame dimensions then rotates the crop layer, preserving image filter", () => {
    render();
    expect(selection().style.visibility).toBe("hidden");
    act(() => observers[0].resize(200, 300));
    expect(selection().style.visibility).toBe("hidden");
    load(1200, 600);
    expect(selection().style.visibility).toBe("visible");
    expect(selection().style.transform).toBe("rotate(90deg)");
    expect(selection().style.width).toBe("300px");
    const image = host.querySelector("img")!;
    expect(image.style.filter).toBe("grayscale(100%)");
    expect(image.style.width).toBe("300px");
    expect(image.style.height).toBe("150px");
    expect(image.style.transform).toBe("");
  });
  it("refits only the active nonzero frame on resize and keeps the loaded raster", () => {
    render();
    load(1200, 600);
    act(() => observers[0].resize(200, 300));
    const image = host.querySelector("img");
    act(() => observers[0].resize(100, 100));
    expect(host.querySelector("img")).toBe(image);
    expect(selection().style.width).toBe("100px");
    expect(selection().style.height).toBe("50px");
    expect(observers).toHaveLength(1);
  });
  it("reads an already cached image from its ref without requiring a second load event", () => {
    render({
      renderImage: (binding) =>
        createElement("img", {
          ...binding,
          alt: "Cached",
          ref: (image: HTMLImageElement | null) => {
            if (image)
              Object.defineProperties(image, {
                naturalWidth: { configurable: true, value: 1200 },
                naturalHeight: { configurable: true, value: 600 },
              });
            binding.ref(image);
          },
        }),
    });
    act(() => observers[0].resize(200, 300));
    expect(selection().style.visibility).toBe("visible");
    expect(selection().style.width).toBe("300px");
  });
  it("disconnects on reset and returns the legacy crop styles exactly", () => {
    render();
    render({ rotation: 0 });
    expect(observers[0].disconnected).toBe(true);
    expect(host.querySelector("[data-image-rotation-frame]")).toBeNull();
    expect(host.querySelector("img")?.className).toBe("object-cover");
    expect(host.querySelector("img")?.style.objectPosition).toBe("30% 70%");
  });
  it("forgets intrinsic sizes and the observer on source replacement, then reads the new raster", () => {
    render();
    act(() => observers[0].resize(200, 300));
    load(1200, 600);
    render({ src: "/replacement" });
    expect(observers[0].disconnected).toBe(true);
    expect(selection().style.visibility).toBe("hidden");
    act(() => observers[1].resize(200, 300));
    load(600, 1200);
    expect(selection().style.width).toBe("100px");
    expect(selection().style.height).toBe("200px");
  });
  it("updates a pending crop in original coordinates without remounting the loaded source", () => {
    render();
    act(() => observers[0].resize(200, 300));
    load(1200, 600);
    const image = host.querySelector("img")!;
    render({ pendingCrop: { x: 30, y: 70, zoom: 140 }, cropAspect: 2 / 3 });
    expect(host.querySelector("img")).toBe(image);
    expect(parseFloat(image.style.left)).toBeCloseTo((-274 * 200) / 429, 5);
    expect(parseFloat(image.style.top)).toBeCloseTo((-120 * 200) / 429, 5);
    expect(observers).toHaveLength(1);
  });
  it("disconnects on unmount without moving consumer DOM outside React", () => {
    render();
    act(() => root.render(null));
    expect(observers[0].disconnected).toBe(true);
    expect(host.children).toHaveLength(0);
  });
});
