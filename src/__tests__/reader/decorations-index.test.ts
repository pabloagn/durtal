import { describe, expect, it } from "vitest";
import {
  DecorationsIndex,
  decorationKey,
} from "@/lib/reader/decorations-index";
describe("section decoration index", () => {
  it("indexes 1000 marks once and reads only the requested section", () => {
    const index = new DecorationsIndex();
    index.set(
      "annotations",
      Array.from({ length: 1000 }, (_, id) => ({
        id: String(id),
        sectionIndex: id % 50,
        signature: "original",
      })),
    );
    expect(index.section(12).size).toBe(20);
    expect(
      [...index.section(12).values()].every(
        (mark) => mark.item.sectionIndex === 12,
      ),
    ).toBe(true);
    expect(index.section(51).size).toBe(0);
  });
  it("diffs moves, edits and removals within one group and preserves colliding groups", () => {
    const index = new DecorationsIndex();
    const mark = { id: "same", sectionIndex: 1, signature: "old" };
    index.set("history", [mark]);
    index.set("annotations", [mark]);
    index.set("search", [mark]);
    expect(
      index.set("annotations", [
        { ...mark, sectionIndex: 2, signature: "new" },
      ]),
    ).toEqual(new Set([1, 2]));
    expect([...index.section(1).values()].map((mark) => mark.group)).toEqual([
      "history",
      "search",
    ]);
    expect(
      index.section(2).get(decorationKey("annotations", "same"))?.item
        .signature,
    ).toBe("new");
    expect(
      index.set("annotations", [{ ...mark, sectionIndex: 2, signature: "new" }])
        .size,
    ).toBe(0);
    index.set("history", []);
    expect(index.section(1).size).toBe(1);
  });
  it("rejects duplicate IDs before changing the prior full-state set", () => {
    const index = new DecorationsIndex();
    const mark = { id: "same", sectionIndex: 1, signature: "old" };
    index.set("annotations", [mark]);
    expect(() => index.set("annotations", [mark, mark])).toThrow("Duplicate");
    expect(index.section(1).size).toBe(1);
  });
});
