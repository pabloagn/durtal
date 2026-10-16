import { describe, expect, it } from "vitest";
import { markOnPassage, samePassage } from "@/lib/reader/same-mark";
import { annotation, id, locator } from "./fixtures/annotation";

const pdf = (page: number, highlight: string, before = "On the page ", after = " it said.") => ({
  ...locator, cfi: undefined, pdf: { page, rects: [[10, 20, 30, 40]] as [number, number, number, number][] },
  text: { before, highlight, after },
});

describe("one mark on a passage (SLN-682)", () => {
  it("matches an EPUB passage by its CFI range", () => {
    expect(samePassage(locator, { ...locator, progression: 0.9 })).toBe(true);
    expect(samePassage(locator, { ...locator, cfi: "epubcfi(/6/4!/4/2/1:0,/1:0,/1:17)" })).toBe(false);
    expect(samePassage(locator, { ...locator, fileHash: "b".repeat(64) })).toBe(false);
    expect(samePassage({ ...locator, cfi: undefined }, { ...locator, cfi: undefined })).toBe(false);
  });

  it("matches a PDF passage by its page and its words in context, whatever the rectangles", () => {
    const a = pdf(3, "the widow");
    expect(samePassage(a, { ...a, pdf: { page: 3, rects: [[10.2, 20, 30, 40]] } })).toBe(true);
    expect(samePassage(a, pdf(4, "the widow"))).toBe(false);
    // The same words elsewhere on the page are another passage
    expect(samePassage(a, pdf(3, "the widow", "Later ", " left."))).toBe(false);
    expect(samePassage(a, locator)).toBe(false);
  });

  it("finds only a live, placed highlight in the same file", () => {
    const mark = annotation();
    expect(markOnPassage([mark], id(3), locator)).toBe(mark);
    expect(markOnPassage([annotation({ deletedAt: "2026-10-09T12:00:00.000000Z" })], id(3), locator)).toBeNull();
    expect(markOnPassage([annotation({ anchorState: "orphaned" })], id(3), locator)).toBeNull();
    expect(markOnPassage([annotation({ kind: "bookmark" })], id(3), locator)).toBeNull();
    expect(markOnPassage([mark], id(9), locator)).toBeNull();
    const quote = annotation({ style: "quote" });
    expect(markOnPassage([quote], id(3), locator)).toBe(quote);
  });
});
