import { describe, it, expect } from "vitest";
import { CACHE_TAGS } from "@/lib/cache";

// ── Cache tag completeness ───────────────────────────────────────────────────

describe("CACHE_TAGS", () => {
  it("has tags for all reference/taxonomy entities", () => {
    const expectedRefTags = [
      "workTypes", "subjects", "genres", "tags", "categories",
      "themes", "literaryMovements", "artTypes", "artMovements",
      "keywords", "attributes", "locations", "recommenders",
      "countries", "authors",
    ];
    for (const tag of expectedRefTags) {
      expect(CACHE_TAGS).toHaveProperty(tag);
    }
  });

  it("has tags for all entity data", () => {
    const expectedDataTags = [
      "works", "editions", "series", "collections",
      "media", "activity", "comments", "orders",
    ];
    for (const tag of expectedDataTags) {
      expect(CACHE_TAGS).toHaveProperty(tag);
    }
  });

  it("reference tags use ref: prefix", () => {
    const refKeys = [
      "workTypes", "subjects", "genres", "tags", "categories",
      "themes", "literaryMovements", "artTypes", "artMovements",
      "keywords", "attributes", "locations", "recommenders",
      "countries", "authors",
    ] as const;
    for (const key of refKeys) {
      expect((CACHE_TAGS as Record<string, string>)[key]).toMatch(/^ref:/);
    }
  });

  it("entity tags use data: prefix", () => {
    const dataKeys = [
      "works", "editions", "series", "collections",
      "media", "activity", "comments", "orders",
    ] as const;
    for (const key of dataKeys) {
      expect((CACHE_TAGS as Record<string, string>)[key]).toMatch(/^data:/);
    }
  });

  it("all tag values are unique", () => {
    const values = Object.values(CACHE_TAGS);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it("has no empty tag values", () => {
    for (const [key, value] of Object.entries(CACHE_TAGS)) {
      expect(value).toBeTruthy();
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});

// ── Missing cache tags ───────────────────────────────────────────────────────

describe("CACHE_TAGS completeness", () => {
  it("should have a tag for venues (missing)", () => {
    // Venues are a first-class entity with CRUD but no cache tag
    expect(CACHE_TAGS).toHaveProperty("venues");
  });

  it("should have a tag for places (missing)", () => {
    // Places are queried frequently but have no cache tag
    expect(CACHE_TAGS).toHaveProperty("places");
  });
});
