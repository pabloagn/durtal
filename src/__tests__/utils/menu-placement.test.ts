import { describe, expect, it } from "vitest";
import { placeMenu } from "@/lib/utils/menu-placement";

const viewport = { left: 0, top: 0, width: 390, height: 844 };
const menu = { width: 280, height: 400 };

describe("dropdown viewport placement", () => {
  it("uses the requested side and alignment when it fits", () => {
    expect(
      placeMenu(
        { left: 300, top: 30, width: 44, height: 44 },
        menu,
        viewport,
        "end",
        "bottom",
      ),
    ).toEqual({ left: 64, top: 78, height: 400 });
  });
  it("flips near the bottom and keeps either horizontal edge inside the gutter", () => {
    expect(
      placeMenu(
        { left: 360, top: 760, width: 24, height: 44 },
        menu,
        viewport,
        "start",
        "bottom",
      ),
    ).toEqual({ left: 102, top: 356, height: 400 });
    expect(
      placeMenu(
        { left: 0, top: 760, width: 24, height: 44 },
        menu,
        viewport,
        "end",
        "top",
      ).left,
    ).toBe(8);
  });
  it("uses the larger side on a short screen and gives the list a scroll limit", () => {
    expect(
      placeMenu(
        { left: 100, top: 130, width: 44, height: 44 },
        menu,
        { ...viewport, height: 300 },
        "center",
        "bottom",
      ),
    ).toEqual({ left: 8, top: 8, height: 118 });
  });
  it("accounts for the visual viewport after zooming or opening the keyboard", () => {
    const bounds = { left: 100, top: 200, width: 240, height: 320 };
    const result = placeMenu(
      { left: 300, top: 450, width: 32, height: 32 },
      menu,
      bounds,
      "end",
      "bottom",
    );
    expect(result).toEqual({ left: 108, top: 208, height: 238 });
  });
  it("keeps an off-screen anchor bounded after its scrolling container moves", () => {
    const result = placeMenu(
      { left: -80, top: -100, width: 32, height: 32 },
      menu,
      viewport,
      "start",
      "top",
    );
    expect(result).toEqual({ left: 8, top: 8, height: 400 });
  });
});
