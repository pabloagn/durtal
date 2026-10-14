import { describe, expect, it } from "vitest";
import { linkedEditionLine } from "@/lib/ebooks/linked-book";

describe("the linked book's edition line (SLN-666)", () => {
  it("joins the publisher, the year and the translators that are there", () => {
    expect(linkedEditionLine({ publisher: "Penguin Classics", year: 2004, translators: ["Robert Baldick"] }))
      .toBe("Penguin Classics · 2004 · translated by Robert Baldick");
    expect(linkedEditionLine({ publisher: null, year: 1884, translators: ["A", "B", "C"] }))
      .toBe("1884 · translated by A, B and C");
    expect(linkedEditionLine({ publisher: "Dedalus", year: null, translators: [] })).toBe("Dedalus");
  });
  it("is empty when the edition says nothing", () => {
    expect(linkedEditionLine({ publisher: "", year: null, translators: [] })).toBe("");
  });
});
