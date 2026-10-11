import { describe, expect, it } from "vitest";
import {
  comicDirection,
  comicFolderContents,
  compareComicPaths,
  touchComicPage,
} from "@/lib/reader/engines/foliate/comic";

describe("comic policies", () => {
  it("sorts paths per segment, including numbered split folders and tied filenames", () => {
    expect(
      [
        "Chapter 0060 (2)/001.png",
        "Chapter 0060/010.png",
        "Chapter 0060/002.png",
        "Chapter 0060/001.png",
      ].sort(compareComicPaths),
    ).toEqual([
      "Chapter 0060/001.png",
      "Chapter 0060/002.png",
      "Chapter 0060/010.png",
      "Chapter 0060 (2)/001.png",
    ]);
    expect(["1.png", "01.png"].sort(compareComicPaths)).toEqual([
      "01.png",
      "1.png",
    ]);
  });

  it("recognizes the exact Manga direction after whitespace trimming", () => {
    expect(comicDirection(" YesAndRightToLeft ")).toBe("rtl");
    expect(comicDirection("Yes")).toBe("ltr");
    expect(comicDirection(undefined)).toBe("ltr");
  });

  it("makes folder contents instead of file-name contents and none for loose images", () => {
    expect(
      comicFolderContents([
        "001.png",
        "A/001.png",
        "A/002.png",
        "A/B/001.png",
        "C/001.png",
      ]),
    ).toEqual([
      { label: "A", href: "A/001.png" },
      { label: "A/B", href: "A/B/001.png" },
      { label: "C", href: "C/001.png" },
    ]);
    expect(comicFolderContents(["001.png", "002.png"])).toEqual([]);
  });

  it("evicts the oldest on the thirteenth load and updates recency on revisits", () => {
    const pages = Array.from({ length: 12 }, (_, i) => i);
    expect(touchComicPage(pages, 12)).toEqual({
      recent: [...pages.slice(1), 12],
      evicted: [0],
    });
    const revisit = touchComicPage(pages, 0);
    expect(revisit.evicted).toEqual([]);
    expect(touchComicPage(revisit.recent, 12).evicted).toEqual([1]);
    expect(pages[0]).toBe(0); // The transition never mutates the caller's cache.
  });

  it("refuses invalid or duplicate cache state", () => {
    expect(() => touchComicPage([0, 0], 1)).toThrow(RangeError);
    expect(() => touchComicPage([], -1)).toThrow(RangeError);
  });
});
