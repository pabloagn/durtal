// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReaderInput, type ReaderActions, type ReaderInput } from "@/lib/reader/input";
import { attachReaderMedia } from "@/lib/reader/media/document";

/* A comic's pages are images: on a phone a tap on one is a tap on the page
 * (an edge turns, the middle shows or hides the bars), and a double tap
 * opens it in the image viewer. In a reflowable book a tap on an image
 * opens the viewer, as before. */

let input: ReaderInput;
let detach: () => void;
let publish: ReturnType<typeof vi.fn<(media: unknown) => void>>;
let actions: Record<"left" | "right" | "toggleBars", ReturnType<typeof vi.fn<() => void>>>;
let clock = 1_000_000;
let image: HTMLImageElement;

const setup = (pageImages: boolean) => {
  document.body.innerHTML = `<img id="page" src="blob:http://localhost/page" alt="Page 1" />`;
  image = document.getElementById("page") as HTMLImageElement;
  image.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 390, bottom: 600, width: 390, height: 600, toJSON() {} }) as DOMRect;
  Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
  actions = { left: vi.fn<() => void>(), right: vi.fn<() => void>(), toggleBars: vi.fn<() => void>() };
  input = createReaderInput({
    actions: { ...actions, next: vi.fn(), prev: vi.fn(), first: vi.fn(), last: vi.fn(), contents: vi.fn(), settings: vi.fn(), fullscreen: vi.fn(), escape: vi.fn() } as unknown as ReaderActions,
    isBlocked: () => false,
    edgeTaps: () => true,
    pageImages: () => pageImages,
    now: () => clock,
  });
  input.attach(document);
  publish = vi.fn<(media: unknown) => void>();
  detach = attachReaderMedia(document, publish, { pageImages });
};

const tap = (x: number, y = 300) => {
  const point = { clientX: x, clientY: y, identifier: 1, target: image } as unknown as Touch;
  for (const type of ["touchstart", "touchend"]) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { touches: type === "touchend" ? [] : [point], changedTouches: [point] });
    image.dispatchEvent(event);
  }
  clock += 1000;
};

beforeEach(() => vi.spyOn(performance, "now").mockReturnValue(5000));
afterEach(() => {
  input.destroy();
  detach();
  vi.restoreAllMocks();
});

describe("taps on a page image", () => {
  it("in a comic, one tap in the middle shows or hides the bars and opens nothing", () => {
    setup(true);
    tap(195);
    expect(actions.toggleBars).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("in a comic, a double tap in the middle opens the image viewer", () => {
    setup(true);
    tap(195);
    tap(200, 305);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0]).toMatchObject({ kind: "image", element: image, caption: "Page 1" });
    // The second tap is the viewer's, not another toggle
    expect(actions.toggleBars).toHaveBeenCalledTimes(1);
  });

  it("in a comic, two slow taps are two taps", () => {
    setup(true);
    tap(195);
    vi.spyOn(performance, "now").mockReturnValue(6000);
    tap(195);
    expect(publish).not.toHaveBeenCalled();
    expect(actions.toggleBars).toHaveBeenCalledTimes(2);
  });

  it("in a comic, the edge strips turn pages however fast they are tapped", () => {
    setup(true);
    tap(380);
    tap(380);
    tap(10);
    expect(actions.right).toHaveBeenCalledTimes(2);
    expect(actions.left).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("in a reflowable book, one tap on an image opens the viewer", () => {
    setup(false);
    tap(195);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(actions.toggleBars).not.toHaveBeenCalled();
  });
});
