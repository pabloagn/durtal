import { describe, expect, it } from "vitest";
import { bleedInsets, NO_BLEED } from "@/lib/utils/full-bleed";

describe("bleedInsets", () => {
  it("reaches both edges of a wide main area around a centered column", () => {
    // 1414px window, 256px sidebar: main 256..1414, column 1152px centered.
    expect(
      bleedInsets({ left: 259, right: 1411 }, { left: 256, right: 1414 }),
    ).toEqual({ left: 3, right: 3 });
    expect(
      bleedInsets({ left: 640, right: 1792 }, { left: 256, right: 2176 }),
    ).toEqual({ left: 384, right: 384 });
  });

  it("is zero when the host already fills main (narrow windows)", () => {
    expect(
      bleedInsets({ left: 0, right: 375 }, { left: 0, right: 375 }),
    ).toEqual(NO_BLEED);
  });

  it("keeps fractional pixels exact", () => {
    expect(
      bleedInsets(
        { left: 300.25, right: 1452.25 },
        { left: 220, right: 1532.5 },
      ),
    ).toEqual({ left: 80.25, right: 80.25 });
  });

  it("never pushes the layer past main", () => {
    expect(
      bleedInsets({ left: 100, right: 900 }, { left: 120, right: 880 }),
    ).toEqual(NO_BLEED);
  });
});
