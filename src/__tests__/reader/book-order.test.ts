import { describe, expect, it } from "vitest";
import { cfiPlace, compareBookPlaces } from "@/lib/reader/book-order";
import type { DurtalLocator } from "@/lib/reader/engine";

const at = (cfi: string | undefined, progression = 0.5, sectionIndex = 1) =>
  ({ v: 1, fileHash: "x", href: "c.xhtml", sectionIndex, progression, totalProgression: progression, cfi }) as DurtalLocator;

describe("cfiPlace (SLN-682)", () => {
  it("reads a range from its start, and a point as it is", () => {
    expect(cfiPlace("epubcfi(/6/4!/4/22,/1:246,/1:250)")).toEqual([6, 4, 4, 22, 1, 246]);
    expect(cfiPlace("epubcfi(/6/4!/4/20/1:192)")).toEqual([6, 4, 4, 20, 1, 192]);
  });

  it("leaves out assertions, even ones holding commas or brackets, and spatial parts", () => {
    expect(cfiPlace("epubcfi(/6/4[ch2]!/4/2[a^,b^]c],/1:3,/1:9)")).toEqual([6, 4, 4, 2, 1, 3]);
    expect(cfiPlace("epubcfi(/6/4!/4/2@50:50)")).toEqual([6, 4, 4, 2]);
  });

  it("gives null for what is not a CFI", () => {
    expect(cfiPlace("page 3")).toBeNull();
    expect(cfiPlace("epubcfi(chapter)")).toBeNull();
  });
});

describe("compareBookPlaces (SLN-682)", () => {
  const sorted = (items: DurtalLocator[]) => [...items].sort(compareBookPlaces).map((item) => item.cfi);

  it("orders marks on one page by their CFIs, though they share one progression", () => {
    const grey = at("epubcfi(/6/4!/4/22,/1:246,/1:250)"), from = at("epubcfi(/6/4!/4/22,/1:50,/1:54)");
    const small = at("epubcfi(/6/4!/4/20,/1:351,/1:356)"), river = at("epubcfi(/6/4!/4/20,/1:192,/1:197)");
    expect(sorted([grey, from, small, river])).toEqual([river.cfi, small.cfi, from.cfi, grey.cfi]);
  });

  it("compares numbers, not text: step 10 comes after step 9", () => {
    expect(sorted([at("epubcfi(/6/4!/4/10/1:0)"), at("epubcfi(/6/4!/4/9/1:0)")])).toEqual(["epubcfi(/6/4!/4/9/1:0)", "epubcfi(/6/4!/4/10/1:0)"]);
  });

  it("goes by section first, and by progression where a CFI is missing or unreadable", () => {
    expect(compareBookPlaces(at("epubcfi(/6/2!/4/90/1:0)", 0.9, 0), at("epubcfi(/6/4!/4/2/1:0)", 0.1, 1))).toBeLessThan(0);
    expect(compareBookPlaces(at(undefined, 0.2), at("epubcfi(/6/4!/4/2/1:0)", 0.3))).toBeLessThan(0);
    expect(compareBookPlaces(at("nonsense", 0.7), at("nonsense", 0.3))).toBeGreaterThan(0);
  });
});
