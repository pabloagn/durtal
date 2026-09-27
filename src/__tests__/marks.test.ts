import { describe, it, expect } from "vitest";
import { WORK_MARKS, parseMarks } from "@/lib/constants/marks";
import { POISON_LABEL } from "@/lib/constants/poison";

describe("book marks", () => {
  it("lists Rare and the poison mark as one group", () => {
    expect(WORK_MARKS.map((m) => [m.key, m.label])).toEqual([
      ["rare", "Rare"],
      ["poison", POISON_LABEL],
    ]);
  });

  it("parses known marks from a URL value, once each", () => {
    expect(parseMarks("rare,poison")).toEqual(["rare", "poison"]);
    expect(parseMarks("poison,poison,,rare,evil")).toEqual(["poison", "rare"]);
    expect(parseMarks(",rare")).toEqual(["rare"]);
    expect(parseMarks("")).toEqual([]);
    expect(parseMarks(undefined)).toEqual([]);
    expect(parseMarks(null)).toEqual([]);
    expect(parseMarks("toString,__proto__")).toEqual([]);
  });
});
