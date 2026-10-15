import { describe, expect, it } from "vitest";
import { fitWords } from "@/components/reader/fit-words";

// Every letter 10px wide
const measure = (text: string) => text.length * 10;

describe("fitWords (SLN-730)", () => {
  it("keeps text that fits", () => {
    expect(fitWords("The Sudden Winter", 170, measure)).toBe("The Sudden Winter");
  });
  it("drops whole words from the end, never part of one", () => {
    expect(fitWords("The Sudden Winter", 160, measure)).toBe("The Sudden…");
    expect(fitWords("The Sudden Winter", 109, measure)).toBe("The…");
    expect(fitWords("Learning your pace", 140, measure)).toBe("Learning your…");
  });
  it("drops the punctuation before the ellipsis", () => {
    expect(fitWords("Part One, The Return", 120, measure)).toBe("Part One…");
  });
  it("shows nothing when not one word fits", () => {
    expect(fitWords("Learning your pace", 80, measure)).toBe("");
    expect(fitWords("Unbreakable", 50, measure)).toBe("");
  });
});
