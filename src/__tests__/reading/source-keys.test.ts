import { describe, expect, it } from "vitest";
import fixture from "../fixtures/reading/source-keys.json";
import * as keys from "@/lib/reading/source-keys";

/* The fixture is written by an independent Python reference, so the seed
   step's Python copy and these builders agree. */

type Builder = (input: never, n?: number) => string;

describe("source keys", () => {
  it("normalizes text as the Python copy does", () => {
    for (const c of fixture.normalize) expect(keys.normalizeKeyText(c.input), c.input).toBe(c.expected);
  });
  it("builds every key in the fixture", () => {
    expect(fixture.keys.length).toBeGreaterThan(30);
    for (const c of fixture.keys) {
      const build = (keys as unknown as Record<string, Builder>)[c.builder];
      expect(build, c.builder).toBeTypeOf("function");
      const n = (c as { n?: number }).n;
      expect(build(c.input as never, n), `${c.builder} ${JSON.stringify(c.input)}`).toBe(c.expected);
    }
  });
  it("refuses a reader key without an e-book id", () => {
    expect(() => keys.readerReadingKey("  ")).toThrow("A reader key needs the e-book's id");
  });
  it("reduces an ISBN to its digits", () => {
    expect(keys.isbnDigits('="9780141182803"')).toBe("9780141182803");
    expect(keys.isbnDigits(null)).toBe("");
  });
});
