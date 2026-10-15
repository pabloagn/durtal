// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// SLN-557: the adjustments come in three groups (Tone, Colour, Framing), one
// in view at a time with every control of it shown, instead of a wrapping row
// of ten buttons over a single slider
const api = vi.hoisted(() => ({ getImagePresentation: vi.fn(), saveImagePresentation: vi.fn() }));
vi.mock("@/lib/actions/image-adjustments", () => api);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { ImageAdjustmentEditor } from "@/components/media/image-adjustment-editor";
import { DEFAULT_IMAGE_ADJUSTMENTS } from "@/lib/utils/image-adjustment-css";

const SOURCE = "/api/media/covers/a.jpg";
const presentation = (over: Record<string, unknown> = {}) => ({
  source: SOURCE,
  preview: SOURCE,
  monochrome: false,
  settings: { ...DEFAULT_IMAGE_ADJUSTMENTS },
  crop: null,
  aspect: null,
  ...over,
});
let root: Root;
let host: HTMLElement;
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

async function open(over?: Record<string, unknown>) {
  api.getImagePresentation.mockResolvedValue(presentation(over));
  await act(async () => root.render(createElement(ImageAdjustmentEditor, { source: SOURCE })));
}
const groups = () => [...host.querySelectorAll('[role="radio"]')].map((item) => item.textContent);
const sliders = () => [...host.querySelectorAll("label")].map((item) => item.textContent);
async function choose(label: string) {
  await act(async () => {
    [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((item) => item.textContent === label)!.click();
  });
}

describe("image adjustment groups", () => {
  it("shows every control of the chosen group, and its value with the unit", async () => {
    await open();
    expect(groups()).toEqual(["Tone", "Colour"]);
    expect(sliders()).toEqual(["Exposure", "Brightness", "Contrast", "Softness"]);
    expect([...host.querySelectorAll("output")].map((item) => item.textContent)).toEqual(["0.00 EV", "100%", "100%", "0.0 px"]);
    await choose("Colour");
    expect(sliders()).toEqual(["Saturation", "Monochrome", "Sepia"]);
  });

  it("offers Framing only for a cropped subject", async () => {
    await open({ crop: { cropX: 50, cropY: 50, cropZoom: 100 } });
    expect(groups()).toEqual(["Tone", "Colour", "Framing"]);
    await choose("Framing");
    expect(sliders()).toEqual(["Zoom", "Horizontal", "Vertical"]);
  });

  it("leaves out Colour while author monochrome is locked on", async () => {
    await open({ monochrome: true, settings: { ...DEFAULT_IMAGE_ADJUSTMENTS, grayscale: 100, saturation: 0 } });
    expect(host.textContent).toContain("Author monochrome stays on");
    // Tone alone: its controls with no one-option switch over them
    expect(groups()).toEqual([]);
    expect(host.querySelector('[role="radiogroup"]')).toBeNull();
    expect(sliders()).toEqual(["Exposure", "Brightness", "Contrast", "Softness"]);
  });

  it("brightens a value once it leaves the default, and signs a positive exposure", async () => {
    await open({ settings: { ...DEFAULT_IMAGE_ADJUSTMENTS, exposure: 0.35 } });
    const [exposure, brightness] = [...host.querySelectorAll("output")];
    expect(exposure.textContent).toBe("+0.35 EV");
    expect(exposure.className).toContain("text-fg-primary");
    expect(brightness.className).toContain("text-fg-secondary");
  });
});
