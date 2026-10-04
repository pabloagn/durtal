import { describe, it, expect } from "vitest";
import {
  MARKS,
  WORK_MARKS,
  marksOf,
  otherMarkedTitle,
  parseMarks,
} from "@/lib/constants/marks";

describe("book marks", () => {
  it("defines Rare, Anathema and Favourite with a full vocabulary", () => {
    expect(
      WORK_MARKS.map((m) => [m.key, m.field, m.label, m.noun, m.plural]),
    ).toEqual([
      ["rare", "isRare", "Rare", "Rarity", "Rarities"],
      ["poison", "isPoison", "Anathema", "Anathema", "Anathemas"],
      ["favourite", "isFavourite", "Favourite", "Favourite", "Favourites"],
    ]);
    for (const mark of WORK_MARKS) {
      expect(mark.markAction).toMatch(/^Mark as /);
      expect(mark.unmarkAction).toMatch(/^(Unmark|Remove) /);
      expect(mark.hint.length).toBeGreaterThan(0);
    }
    expect(MARKS.poison).toBe(WORK_MARKS[1]);
  });

  it("titles the book-page rows from each mark's plural", () => {
    expect(otherMarkedTitle(MARKS.rare)).toBe("Other Rarities");
    expect(otherMarkedTitle(MARKS.poison)).toBe("Other Anathemas");
    expect(otherMarkedTitle(MARKS.favourite)).toBe("Other Favourites");
  });

  it("lists the marks a work has, in registry order", () => {
    expect(marksOf({ isRare: true, isPoison: true }).map((m) => m.key)).toEqual(
      ["rare", "poison"],
    );
    expect(marksOf({ isPoison: true }).map((m) => m.key)).toEqual(["poison"]);
    expect(marksOf({ isRare: false, isPoison: null })).toEqual([]);
  });

  it("parses known marks from a URL value, once each", () => {
    expect(parseMarks("rare,poison")).toEqual(["rare", "poison"]);
    expect(parseMarks("favourite,rare")).toEqual(["favourite", "rare"]);
    expect(parseMarks("poison,poison,,rare,evil")).toEqual(["poison", "rare"]);
    expect(parseMarks(",rare")).toEqual(["rare"]);
    expect(parseMarks("")).toEqual([]);
    expect(parseMarks(undefined)).toEqual([]);
    expect(parseMarks(null)).toEqual([]);
    expect(parseMarks("toString,__proto__")).toEqual([]);
  });
});
