import { describe, expect, it } from "vitest";
import {
  annotationBodySchema,
  annotationLocatorSchema,
} from "@/lib/validations/annotations";
import { annotationCharacterCount } from "@/lib/reader/annotations";
import { at, id, locator, put } from "./fixtures/annotation";
const schema = annotationBodySchema(Date.parse(at));
const body = (upserts: unknown[]) => ({ upserts, deletes: [] });

describe("annotation input boundaries", () => {
  it("accepts a complete 10,000-codepoint quote and note without truncation", () => {
    const text = "𐐀".repeat(10_000),
      note = "🙂".repeat(10_000);
    const result = schema.parse(
      body([
        put({ text, note, locator: { ...locator, text: { highlight: text } } }),
      ]),
    );
    expect(result.upserts[0]).toMatchObject({ text, note });
    expect(annotationCharacterCount(text)).toBe(10_000);
  });
  it("rejects 10,001 characters, malformed ids, NUL and incomplete Unicode", () => {
    for (const item of [
      put({ note: "x".repeat(10_001) }),
      { ...put(), id: "bad" },
      put({ note: "\u0000" }),
      put({ note: "\ud800" }),
    ])
      expect(schema.safeParse(body([item])).success).toBe(false);
  });
  it("rejects browser quote privilege and server-owned fields", () => {
    for (const item of [
      { ...put(), style: "quote" },
      { ...put(), ebookId: id(2) },
      { ...put(), deletedAt: at },
      { ...put(), anchorState: "exact" },
    ])
      expect(schema.safeParse(body([item])).success).toBe(false);
  });
  it("validates the combined count and disallows contradictory writes to one id", () => {
    expect(
      schema.safeParse(
        body(Array.from({ length: 200 }, (_, i) => put({ id: id(i + 10) }))),
      ).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        upserts: Array.from({ length: 200 }, (_, i) => put({ id: id(i + 10) })),
        deletes: [{ id: id(999), clientUpdatedAt: at }],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        upserts: [put()],
        deletes: [{ id: id(1), clientUpdatedAt: at }],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse(body([put(), put({ id: id(1).toUpperCase() })])).success,
    ).toBe(false);
  });
  it("refuses far-future timestamps and preserves microsecond precision and offsets", () => {
    expect(
      schema.safeParse(
        body([put({ clientUpdatedAt: "2026-10-09T12:05:00.000001Z" })]),
      ).success,
    ).toBe(false);
    expect(
      schema.parse(
        body([put({ clientUpdatedAt: "2026-10-09T14:00:00.123456+02:00" })]),
      ).upserts[0],
    ).toMatchObject({ clientUpdatedAt: "2026-10-09T12:00:00.123456Z" });
  });
  it("does not silently accept an empty passage or highlight metadata on a bookmark", () => {
    expect(schema.safeParse(body([put({ text: " " })])).success).toBe(false);
    expect(schema.safeParse(body([put({ kind: "bookmark" })])).success).toBe(
      false,
    );
    expect(
      schema.safeParse(
        body([put({ kind: "bookmark", color: null, text: null, note: null })]),
      ).success,
    ).toBe(true);
  });
  it("rejects malformed locators before any ownership lookup is possible", () => {
    for (const patch of [
      { fileHash: "bad" },
      { sectionIndex: -1 },
      { totalProgression: Infinity },
      { progression: NaN },
      { text: { before: "x".repeat(65) } },
    ])
      expect(
        annotationLocatorSchema.safeParse({ ...locator, ...patch }).success,
      ).toBe(false);
  });
});
