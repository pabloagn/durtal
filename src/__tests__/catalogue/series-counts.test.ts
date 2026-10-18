import { describe, expect, it } from "vitest";
import { seriesBooksLabel, seriesOutOf } from "@/lib/series/counts";

// SLN-915: a series over its total read "5 books of 4", "5 of 4 owned" and
// "Read 2 of 3"
describe("a series' counts", () => {
  it("say the total when the books fit in it", () => {
    expect(seriesBooksLabel(3, 7)).toBe("3 books of 7");
    expect(seriesBooksLabel(4, 4)).toBe("4 books of 4");
    expect(seriesBooksLabel(1, null)).toBe("1 book");
    expect(seriesOutOf(3, 7)).toBe(7);
    expect(seriesOutOf(3, null)).toBe(3);
  });

  it("leave a total out that the books exceed, and count against the books", () => {
    expect(seriesBooksLabel(5, 4)).toBe("5 books");
    expect(seriesBooksLabel(5, 3)).toBe("5 books");
    expect(seriesOutOf(5, 3)).toBe(5);
  });
});
