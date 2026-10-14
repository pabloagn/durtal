import { describe, expect, it } from "vitest";
import { immutableMatchingWriterInput, sealParsedJson } from "@/lib/ebooks/match/writer-input";

describe("sealed matching writer inputs (SLN-691)", () => {
  it("shares a sealed value in a later copy instead of copying it again", () => {
    const rows = immutableMatchingWriterInput([{ id: "a", metadata: { tags: ["x"] } }]);
    const plan = immutableMatchingWriterInput({ snapshot: { rows: { works: rows } } });
    expect(plan.snapshot.rows.works).toBe(rows);
    expect(Object.isFrozen(plan.snapshot)).toBe(true);
  });
  it("seals parsed JSON in place, deeply, and a copy then shares it", () => {
    const rows = sealParsedJson(JSON.parse('[{"id":"a","metadata":{"tags":["x"]}}]') as { id: string; metadata: { tags: string[] } }[]);
    expect(Object.isFrozen(rows) && Object.isFrozen(rows[0]) && Object.isFrozen(rows[0].metadata.tags)).toBe(true);
    expect(() => { (rows[0] as { id: string }).id = "b"; }).toThrow(TypeError);
    expect(immutableMatchingWriterInput({ rows }).rows).toBe(rows);
  });
  it.each([
    ["a Date", [new Date(0)]],
    ["undefined", [undefined]],
    ["a hole", Array(1)],
    ["NaN", [Number.NaN]],
    ["a symbol key", [{ [Symbol("hidden")]: 1 }]],
    ["a class instance", [new Map()]],
  ])("refuses %s, which parsed JSON never holds", (_label, value) => {
    expect(() => sealParsedJson(value)).toThrow("Only parsed JSON can be sealed in place");
  });
  it("refuses a cycle", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => sealParsedJson(cycle)).toThrow("Only parsed JSON can be sealed in place");
  });
});
