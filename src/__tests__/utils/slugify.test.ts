import { describe, it, expect } from "vitest";
import {
  slugify,
  truncateAtWordBoundary,
  generateWorkSlug,
  generateAuthorSlug,
  makeUnique,
} from "@/lib/utils/slugify";

// ── slugify ────────────────────────────────────────────────────────────────────

describe("slugify", () => {
  it("lowercases and hyphenates basic text", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("strips diacritics via NFD normalization", () => {
    expect(slugify("café résumé naïve")).toBe("cafe-resume-naive");
  });

  it("transliterates Polish characters", () => {
    expect(slugify("Stanisław Łem")).toBe("stanislaw-lem");
  });

  it("transliterates Scandinavian characters", () => {
    expect(slugify("Søren Kierkegaard")).toBe("soren-kierkegaard");
    expect(slugify("Ásgeir Trausti")).toBe("asgeir-trausti");
  });

  it("transliterates German ß", () => {
    expect(slugify("Straße")).toBe("strasse");
  });

  it("transliterates æ and œ digraphs", () => {
    expect(slugify("Æneid")).toBe("aeneid");
    expect(slugify("Œuvre")).toBe("oeuvre");
  });

  it("transliterates Icelandic ð and þ", () => {
    expect(slugify("Guðmundur")).toBe("gudmundur");
    expect(slugify("Þórr")).toBe("thorr");
  });

  it("collapses multiple hyphens", () => {
    expect(slugify("Hello---World")).toBe("hello-world");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  it("handles purely non-Latin text gracefully", () => {
    // Chinese, Japanese etc. will be stripped → empty
    expect(slugify("日本語")).toBe("");
  });

  it("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("handles numbers", () => {
    expect(slugify("Room 101")).toBe("room-101");
  });

  it("strips special characters", () => {
    expect(slugify("Don Quixote: Part I & II")).toBe("don-quixote-part-i-ii");
  });
});

// ── truncateAtWordBoundary ──────────────────────────────────────────────────

describe("truncateAtWordBoundary", () => {
  it("returns text as-is if within limit", () => {
    expect(truncateAtWordBoundary("hello", 10)).toBe("hello");
  });

  it("truncates at last hyphen before limit", () => {
    expect(truncateAtWordBoundary("the-great-gatsby-by-fitzgerald", 20)).toBe(
      "the-great-gatsby-by",
    );
  });

  it("hard truncates if first word exceeds limit", () => {
    expect(truncateAtWordBoundary("superlongword", 5)).toBe("super");
  });

  it("handles exact boundary", () => {
    expect(truncateAtWordBoundary("exact", 5)).toBe("exact");
  });
});

// ── generateWorkSlug ──────────────────────────────────────────────────────────

describe("generateWorkSlug", () => {
  it("generates title-by-author format", () => {
    expect(generateWorkSlug("Don Quixote", "Miguel de Cervantes")).toBe(
      "don-quixote-by-miguel-de-cervantes",
    );
  });

  it("truncates long titles at 30 chars", () => {
    const slug = generateWorkSlug(
      "One Hundred Years of Solitude in the Land of Magical Realism",
      "Gabriel García Márquez",
    );
    const titlePart = slug.split("-by-")[0];
    expect(titlePart.length).toBeLessThanOrEqual(30);
  });

  it("falls back to ID when title slugifies to empty", () => {
    const slug = generateWorkSlug("日本語", "", "abc12345-6789");
    expect(slug).toBe("abc12345");
  });

  it("omits -by- when author is empty", () => {
    const slug = generateWorkSlug("Beowulf", "");
    expect(slug).toBe("beowulf");
  });

  it("handles both empty with fallback ID", () => {
    const slug = generateWorkSlug("", "", "abc12345-6789");
    expect(slug).toBe("abc12345");
  });

  it("handles both empty without fallback", () => {
    const slug = generateWorkSlug("", "");
    expect(slug).toBe("work");
  });
});

// ── generateAuthorSlug ────────────────────────────────────────────────────────

describe("generateAuthorSlug", () => {
  it("generates slug from name", () => {
    expect(generateAuthorSlug("Jorge Luis Borges")).toBe("jorge-luis-borges");
  });

  it("handles diacritics", () => {
    expect(generateAuthorSlug("Gabriel García Márquez")).toBe(
      "gabriel-garcia-marquez",
    );
  });

  it("falls back to 'author' for empty result", () => {
    expect(generateAuthorSlug("日本語")).toBe("author");
  });
});

// ── makeUnique ────────────────────────────────────────────────────────────────

describe("makeUnique", () => {
  it("returns base slug if no conflict", () => {
    expect(makeUnique("hello", ["world"])).toBe("hello");
  });

  it("appends -2 on first conflict", () => {
    expect(makeUnique("hello", ["hello"])).toBe("hello-2");
  });

  it("increments counter through conflicts", () => {
    expect(makeUnique("hello", ["hello", "hello-2", "hello-3"])).toBe("hello-4");
  });

  it("handles empty existing list", () => {
    expect(makeUnique("hello", [])).toBe("hello");
  });
});
