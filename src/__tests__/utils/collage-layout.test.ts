import { describe, it, expect } from "vitest";
import {
  computeCollageLayout,
  layoutMatchesMedia,
} from "@/lib/utils/collage-layout";

const imgs = (ids: string[]) => ids.map((id) => ({ id, width: 800, height: 600 }));

describe("layoutMatchesMedia", () => {
  it("accepts a layout computed for the same images", () => {
    for (const n of [1, 2, 3, 5, 7, 12]) {
      const ids = Array.from({ length: n }, (_, i) => `m${i}`);
      expect(layoutMatchesMedia(computeCollageLayout(imgs(ids), 42), ids)).toBe(true);
    }
  });

  it("rejects a layout when one image was replaced by another", () => {
    const layout = computeCollageLayout(imgs(["a", "b", "c"]), 42);
    expect(layoutMatchesMedia(layout, ["a", "b", "d"])).toBe(false);
  });

  it("rejects a layout when the image count changed", () => {
    const layout = computeCollageLayout(imgs(["a", "b", "c"]), 42);
    expect(layoutMatchesMedia(layout, ["a", "b"])).toBe(false);
    expect(layoutMatchesMedia(layout, ["a", "b", "c", "d"])).toBe(false);
  });

  it("accepts an empty layout for no images", () => {
    expect(layoutMatchesMedia({ blocks: [] }, [])).toBe(true);
  });
});
