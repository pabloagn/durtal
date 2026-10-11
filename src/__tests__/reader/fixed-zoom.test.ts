import { describe, expect, it } from "vitest";
import {
  clampFixedZoom,
  defaultFixedFit,
  fitZoomAttribute,
  fixedShortcut,
  fixedSpreadMode,
  fixedZoomScale,
  FIXED_ZOOM_PRESETS,
  stepFixedZoom,
} from "@/lib/reader/engines/foliate/fixed";

describe("fixed fit, zoom and spreads", () => {
  it("steps all presets, also from a continuous pinch scale, with endpoint limits", () => {
    expect(FIXED_ZOOM_PRESETS).toEqual([50, 75, 100, 125, 150, 200, 300, 400]);
    expect(FIXED_ZOOM_PRESETS.map((n) => stepFixedZoom(n, 1))).toEqual([
      75, 100, 125, 150, 200, 300, 400, 400,
    ]);
    expect(FIXED_ZOOM_PRESETS.map((n) => stepFixedZoom(n, -1))).toEqual([
      50, 50, 75, 100, 125, 150, 200, 300,
    ]);
    expect(stepFixedZoom(137, 1)).toBe(150);
    expect(stepFixedZoom(137, -1)).toBe(125);
    expect(clampFixedZoom(49)).toBe(50);
    expect(clampFixedZoom(450)).toBe(400);
    expect(() => clampFixedZoom(NaN)).toThrow(RangeError);
  });

  it("uses printed PDF size and original image/EPUB viewport size at 100%", () => {
    expect(fixedZoomScale("pdf", 100)).toBeCloseTo(96 / 72);
    expect(fixedZoomScale("cbz", 100)).toBe(1);
    expect(fixedZoomScale("epub", 100)).toBe(1);
  });

  it("maps fit defaults and shortcuts without persisting zoom", () => {
    expect(
      ["phone", "tablet", "desktop"].map((device) =>
        defaultFixedFit(device as "phone" | "tablet" | "desktop"),
      ),
    ).toEqual(["width", "page", "page"]);
    expect(fitZoomAttribute("page")).toBe("fit-page");
    expect(fitZoomAttribute("width")).toBe("fit-width");
    expect(fixedShortcut("+", 100, "page")).toEqual({ zoom: 125 });
    expect(fixedShortcut("=", 100, "page")).toEqual({ zoom: 125 });
    expect(fixedShortcut("-", 100, "page")).toEqual({ zoom: 75 });
    expect(fixedShortcut("0", 300, "width")).toEqual({ fit: "width" });
    expect(fixedShortcut("w", 300, "width")).toEqual({ fit: "page" });
    expect(fixedShortcut("q", 100, "page")).toBeNull();
  });

  const area = {
    preference: "auto" as const,
    areaWidth: 1000,
    areaHeight: 800,
    pageWidth: 600,
    pageHeight: 800,
  };
  it("requires 1000px, a landscape reading area and portrait pages for Auto", () => {
    expect(fixedSpreadMode(area)).toBe("both");
    expect(fixedSpreadMode({ ...area, areaWidth: 999 })).toBe("none");
    expect(fixedSpreadMode({ ...area, areaHeight: 1200 })).toBe("none");
    expect(fixedSpreadMode({ ...area, pageWidth: 900 })).toBe("none");
    expect(fixedSpreadMode({ ...area, pageWidth: 800 })).toBe("none");
  });

  it("honours author constraints in Auto and explicit One/Two overrides", () => {
    expect(fixedSpreadMode({ ...area, renditionSpread: "none" })).toBe("none");
    expect(fixedSpreadMode({ ...area, renditionSpread: "portrait" })).toBe(
      "none",
    );
    expect(fixedSpreadMode({ ...area, renditionSpread: "landscape" })).toBe(
      "both",
    );
    expect(
      fixedSpreadMode({ ...area, renditionSpread: "none", preference: "both" }),
    ).toBe("both");
    expect(fixedSpreadMode({ ...area, preference: "none" })).toBe("none");
    expect(() => fixedSpreadMode({ ...area, pageHeight: 0 })).toThrow(
      RangeError,
    );
  });
});
