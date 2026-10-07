import { describe, expect, it, vi } from "vitest";

// Any database call fails the test: a bad input is refused before one
const touched = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: () => {
        touched();
        throw new Error("The database was touched");
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({ cached: (fn: unknown) => fn, invalidate: vi.fn(), CACHE_TAGS: {} }));
import { markWorksRead, undoMarkWorksRead } from "@/lib/actions/reading-bulk";
import { FEEDBACK_REASONS, formatOfCopies } from "@/lib/reading/constants";
import { FEEDBACK_REASON_DIMENSIONS } from "@/lib/enrichment/feedback";

// Bulk Mark as read and the feedback dimensions (SLN-463): the pure rules

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const many = (n: number) => Array.from({ length: n }, (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`);

describe("Mark as read refuses a bad input before any database call", () => {
  it.each([
    ["a bad id", { workIds: ["not-a-uuid"] }],
    ["an empty list", { workIds: [] }],
    ["more than 1000 books", { workIds: many(1001) }],
    ["a source", { workIds: [A], source: "manual" }],
    ["a source key", { workIds: [A], sourceKey: "manual:1" }],
    ["an unknown key", { workIds: [A], status: "finished" }],
    ["a confirmed book outside the selection", { workIds: [A], confirmDuplicates: [B] }],
  ])("markWorksRead: %s", async (_, input) => {
    await expect(markWorksRead(input as never)).rejects.toThrow();
    expect(touched).not.toHaveBeenCalled();
  });

  it.each([
    ["a bad id", { readingIds: ["not-a-uuid"] }],
    ["an empty list", { readingIds: [] }],
    ["more than 1000 readings", { readingIds: many(1001) }],
    ["a source", { readingIds: [A], source: "manual" }],
    ["an unknown key", { readingIds: [A], workIds: [B] }],
  ])("undoMarkWorksRead: %s", async (_, input) => {
    await expect(undoMarkWorksRead(input as never)).rejects.toThrow();
    expect(touched).not.toHaveBeenCalled();
  });
});

describe("the format of a marked read", () => {
  it.each([
    [[], "print"],
    [[null], "print"],
    [["epub", "pdf"], "ebook"],
    [["audiobook"], "audio"],
    [["hardcover", "paperback"], "print"],
    [["hardcover", "epub"], "print"],
  ])("copies %j read as %s", (formats, expected) => {
    expect(formatOfCopies(formats as (string | null)[])).toBe(expected);
  });
});

describe("FEEDBACK_REASON_DIMENSIONS", () => {
  // Vocabulary v1's dimension keys (its section 8); the seed replaces this list when it lands
  const V1_DIMENSIONS = ["pages", "prose", "speculative_level", "popularity"];

  it("names a dimension or none for every reason code, and only v1's keys", () => {
    expect(Object.keys(FEEDBACK_REASON_DIMENSIONS).sort()).toEqual([...FEEDBACK_REASONS].sort());
    for (const key of Object.values(FEEDBACK_REASON_DIMENSIONS)) if (key !== null) expect(V1_DIMENSIONS).toContain(key);
    expect(FEEDBACK_REASON_DIMENSIONS).toMatchObject({ too_long: "pages", too_short: "pages", prose: "prose", genre: "speculative_level", too_popular: "popularity" });
  });
});
