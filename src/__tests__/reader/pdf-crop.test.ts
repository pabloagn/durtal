import { describe, expect, it } from "vitest";
import {
  cropEnabled,
  detectContentBox,
  isScannedPage,
} from "@/lib/reader/engines/foliate/pdf-crop";

function page(width = 500, height = 500, paper = 240, ink = 30, margin = 60) {
  const luma = new Uint8Array(width * height).fill(paper);
  for (let y = margin; y < height - margin; y++) {
    for (let x = margin; x < width - margin; x++) luma[y * width + x] = ink;
  }
  return luma;
}

describe("PDF crop detection", () => {
  it("finds 12% margins and adds 2% of the whole page back", () => {
    expect(detectContentBox(page(), 500, 500)).toEqual({
      left: 50,
      top: 50,
      right: 450,
      bottom: 450,
    });
  });

  it("ignores isolated specks below 0.4% row/column density", () => {
    const luma = page();
    luma[10 * 500 + 10] = 0;
    expect(detectContentBox(luma, 500, 500)).toEqual({
      left: 50,
      top: 50,
      right: 450,
      bottom: 450,
    });
  });

  it("finds light ink on dark paper using tone difference rather than whiteness", () => {
    expect(detectContentBox(page(500, 500, 20, 220), 500, 500)).toEqual({
      left: 50,
      top: 50,
      right: 450,
      bottom: 450,
    });
  });

  it("caps each removed side at 25%", () => {
    const luma = new Uint8Array(500 * 500).fill(240);
    for (let y = 50; y < 450; y++)
      for (let x = 160; x < 450; x++) luma[y * 500 + x] = 30;
    expect(detectContentBox(luma, 500, 500)).toEqual({
      left: 125,
      top: 40,
      right: 460,
      bottom: 460,
    });
  });

  it("retains blank pages, full-bleed pages and candidates below 40% area", () => {
    expect(
      detectContentBox(new Uint8Array(500 * 500).fill(240), 500, 500),
    ).toBeNull();
    expect(detectContentBox(page(500, 500, 240, 30, 180), 500, 500)).toBeNull();
    const full = page(500, 500, 240, 30, 0);
    for (let i = 0; i < full.length; i += 2) full[i] = 240;
    expect(detectContentBox(full, 500, 500)).toBeNull();
  });

  it("uses a strict >40 tone threshold", () => {
    expect(detectContentBox(page(500, 500, 240, 200), 500, 500)).toBeNull();
    expect(detectContentBox(page(500, 500, 240, 199), 500, 500)).not.toBeNull();
  });

  it.each([
    [0, 1],
    [1.5, 2],
    [2, 2],
  ])("refuses invalid dimensions or length %s x %s", (width, height) => {
    expect(() => detectContentBox(new Uint8Array(2), width, height)).toThrow(
      RangeError,
    );
  });

  it("uses actual image coverage and text only for first-page Auto", () => {
    expect(isScannedPage([0.9], false)).toBe(true);
    expect(isScannedPage([0.89], false)).toBe(false);
    expect(isScannedPage([1], true)).toBe(false);
    expect(isScannedPage([0.5, 0.5], false)).toBe(false);
    expect(isScannedPage([NaN], false)).toBe(false);
    expect(cropEnabled("auto", true)).toBe(true);
    expect(cropEnabled("auto", false)).toBe(false);
    expect(cropEnabled("on", false)).toBe(true);
    expect(cropEnabled("off", true)).toBe(false);
  });
});
