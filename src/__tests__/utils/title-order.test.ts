import { describe, expect, it } from "vitest";
import { compareTitles, compareWorks } from "@/lib/utils/title-order";

describe("alphabetical titles", () => {
  it("ignores case, accents, and surrounding whitespace", () => {
    expect(compareTitles(" ÉTÉ ", "ete")).toBe(0);
    expect(["Zulu", "éclair", "apple", "Beta"].sort(compareTitles)).toEqual([
      "apple",
      "Beta",
      "éclair",
      "Zulu",
    ]);
  });

  it("puts numbered volumes in natural order", () => {
    expect(
      ["Volume: 10", "Volume: 2", "Volume: 1"].sort(compareTitles),
    ).toEqual(["Volume: 1", "Volume: 2", "Volume: 10"]);
  });

  it("breaks equivalent title ties by ID in both directions", () => {
    const books = [
      { id: "b", title: "Été" },
      { id: "a", title: "ete" },
    ];
    expect([...books].sort(compareWorks).map((w) => w.id)).toEqual(["a", "b"]);
    expect(
      [...books].sort((a, b) => compareWorks(a, b, "desc")).map((w) => w.id),
    ).toEqual(["a", "b"]);
  });
});
