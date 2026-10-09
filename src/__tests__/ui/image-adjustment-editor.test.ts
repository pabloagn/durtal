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
import { ImageAdjustmentEditor } from "@/components/media/image-adjustment-editor";
import { DEFAULT_IMAGE_ADJUSTMENTS } from "@/lib/utils/image-adjustment-css";

const actions = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
  refresh: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@/lib/actions/image-adjustments", () => ({
  getImagePresentation: actions.get,
  saveImagePresentation: actions.save,
}));
vi.mock("@/components/media/image-adjustment-provider", () => ({
  useImageAdjustmentUpdate: () => actions.update,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: actions.refresh }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: actions.error },
}));

const source = "/api/s3/read?key=gold/media/synthetic.webp";
function presentation(monochrome = false, framed = true) {
  return {
    assetKey: "gold/media/synthetic.webp",
    source,
    preview: source,
    monochrome,
    settings: {
      ...DEFAULT_IMAGE_ADJUSTMENTS,
      exposure: 0.2,
      contrast: 120,
      grayscale: monochrome ? 100 : 0,
    },
    crop: framed ? { cropX: 30, cropY: 40, cropZoom: 140 } : null,
    aspect: framed ? 2 / 3 : null,
  };
}
let root: Root;
let host: HTMLDivElement;
beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  actions.get.mockResolvedValue(presentation());
  actions.save.mockImplementation(async (_source, data) => ({
    assetKey: "gold/media/new.webp",
    sources: [],
    settings: data.settings,
    monochrome: false,
  }));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(nextSource = source) {
  await act(async () => {
    root.render(createElement(ImageAdjustmentEditor, { source: nextSource }));
  });
}
function button(label: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) =>
      el.getAttribute("aria-label") === label ||
      el.textContent?.trim() === label,
  )!;
}
function click(label: string) {
  act(() => button(label).click());
}
function slide(value: number) {
  const range = host.querySelector<HTMLInputElement>('input[type="range"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(range, String(value));
    range.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("image adjustment editing across groups", () => {
  it("resets one setting without losing other groups, then resets and saves every group", async () => {
    await render();
    slide(0.7);
    click("Colour");
    slide(160);
    click("Reset Saturation");
    click("Tone");
    expect(
      host.querySelector<HTMLInputElement>('input[type="range"]')!.value,
    ).toBe("0.7");
    expect(button("Save").disabled).toBe(false);
    click("Reset all");
    await act(async () => button("Save").click());
    expect(actions.save).toHaveBeenCalledWith(source, {
      settings: DEFAULT_IMAGE_ADJUSTMENTS,
      crop: { cropX: 50, cropY: 50, cropZoom: 100 },
    });
    expect(actions.update).toHaveBeenCalledOnce();
    expect(button("Save").disabled).toBe(true);
  });

  it("keeps the saved comparison baseline and resets monochrome without exposing unsupported groups", async () => {
    actions.get.mockResolvedValue(presentation(true, false));
    await render();
    expect(button("Colour")).toBeUndefined();
    expect(button("Framing")).toBeUndefined();
    const image = host.querySelector<HTMLImageElement>("img")!;
    const savedFilter = image.style.filter;
    slide(1);
    expect(image.style.filter).not.toBe(savedFilter);
    click("Compare");
    expect(image.style.filter).toBe(savedFilter);
    click("Reset all");
    expect(button("Compare").getAttribute("aria-pressed")).toBe("false");
    await act(async () => button("Save").click());
    expect(actions.save).toHaveBeenCalledWith(source, {
      settings: { ...DEFAULT_IMAGE_ADJUSTMENTS, grayscale: 100 },
    });
  });

  it("retains changes after a failed save and uses the new asset identity after retry", async () => {
    actions.save.mockRejectedValueOnce(new Error("synthetic failure"));
    await render();
    slide(0.8);
    await act(async () => button("Save").click());
    expect(actions.error).toHaveBeenCalledOnce();
    expect(
      host.querySelector<HTMLInputElement>('input[type="range"]')!.value,
    ).toBe("0.8");
    expect(button("Save").disabled).toBe(false);
    await act(async () => button("Save").click());
    slide(0.9);
    await act(async () => button("Save").click());
    expect(actions.save.mock.calls[2][0]).toBe(
      "/api/s3/read?key=gold%2Fmedia%2Fnew.webp",
    );
    expect(actions.refresh).toHaveBeenCalledTimes(2);
  });

  it("does not expose editing actions before loading succeeds, including retry after failure", async () => {
    let reject!: (error: Error) => void;
    actions.get.mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
    );
    await render();
    expect(host.querySelector("button")).toBeNull();
    await act(async () => reject(new Error("synthetic unavailable image")));
    expect(button("Save")).toBeUndefined();
    expect(button("Reset all")).toBeUndefined();
    expect(button("Compare")).toBeUndefined();
    await act(async () => button("Retry").click());
    expect(host.querySelector("fieldset")).not.toBeNull();
  });

  it("ignores a stale loading result when the editor switches to another image", async () => {
    let resolveOld!: (value: ReturnType<typeof presentation>) => void;
    actions.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    await render();
    const second = {
      ...presentation(false, false),
      source: "/api/s3/read?key=gold/media/second.webp",
    };
    actions.get.mockResolvedValueOnce(second);
    await render(second.source);
    await act(async () => resolveOld(presentation()));
    expect(button("Framing")).toBeUndefined();
    slide(1);
    await act(async () => button("Save").click());
    expect(actions.save.mock.calls[0][0]).toBe(second.source);
  });
});
