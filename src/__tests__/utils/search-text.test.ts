import { describe, it, expect } from "vitest";
import {
  filterBySearch,
  normalizeSearchText,
  searchScore,
  searchTokens,
} from "@/lib/utils/search-text";

// ── normalizeSearchText ────────────────────────────────────────────────────────

describe("normalizeSearchText", () => {
  it("removes accents and lower-cases", () => {
    expect(normalizeSearchText("Péter Nádas")).toBe("peter nadas");
    expect(normalizeSearchText("Gabriel García Márquez")).toBe("gabriel garcia marquez");
  });

  it("transliterates letters that do not decompose", () => {
    expect(normalizeSearchText("Søren Kierkegaard")).toBe("soren kierkegaard");
    expect(normalizeSearchText("Stanisław Lem")).toBe("stanislaw lem");
    expect(normalizeSearchText("Straße")).toBe("strasse");
  });

  it("turns punctuation and extra spaces into single spaces", () => {
    expect(normalizeSearchText("Murray Gell-Mann")).toBe("murray gell mann");
    expect(normalizeSearchText("  Nádas,   Péter ")).toBe("nadas peter");
    expect(normalizeSearchText("J.R.R. Tolkien")).toBe("j r r tolkien");
  });

  it("keeps non-Latin letters", () => {
    expect(normalizeSearchText("Фёдор Достоевский")).toBe("федор достоевскии");
  });
});

// ── searchTokens ───────────────────────────────────────────────────────────────

describe("searchTokens", () => {
  it("splits a query into normalized words", () => {
    expect(searchTokens("Nádas, Péter")).toEqual(["nadas", "peter"]);
  });

  it("is empty for a blank or punctuation-only query", () => {
    expect(searchTokens("")).toEqual([]);
    expect(searchTokens("   ")).toEqual([]);
    expect(searchTokens("%_-")).toEqual([]);
  });
});

// ── searchScore ────────────────────────────────────────────────────────────────

describe("searchScore", () => {
  it("matches without accents, in any word order", () => {
    expect(searchScore("Peter Nadas", "Péter Nádas")).toBeGreaterThanOrEqual(0);
    expect(searchScore("nadas peter", "Péter Nádas")).toBeGreaterThanOrEqual(0);
    expect(searchScore("NADAS", "Péter Nádas")).toBeGreaterThanOrEqual(0);
  });

  it("does not match when a word is missing", () => {
    expect(searchScore("peter borges", "Péter Nádas")).toBe(-1);
  });

  it("ranks exact > starts with > word starts > all word starts > contains", () => {
    expect(searchScore("peter nadas", "Péter Nádas")).toBe(4);
    expect(searchScore("peter", "Péter Nádas")).toBe(3);
    expect(searchScore("nadas", "Péter Nádas")).toBe(2);
    expect(searchScore("nadas peter", "Péter Nádas")).toBe(1);
    expect(searchScore("ada", "Péter Nádas")).toBe(0);
  });

  it("scores a blank query as a match", () => {
    expect(searchScore("", "anything")).toBe(0);
  });
});

// ── filterBySearch ─────────────────────────────────────────────────────────────

describe("filterBySearch", () => {
  const authors = [
    { name: "Clemens Setz" },
    { name: "Stanisław Lem" },
    { name: "Lemony Snicket" },
    { name: "Péter Nádas" },
  ];

  it("keeps only matches, best first", () => {
    expect(filterBySearch(authors, "lem", (a) => a.name).map((a) => a.name)).toEqual([
      "Lemony Snicket", // starts with the query
      "Stanisław Lem", // a word starts with the query
      "Clemens Setz", // contains the query
    ]);
  });

  it("finds accented names from a plain query", () => {
    expect(filterBySearch(authors, "stanislaw", (a) => a.name)).toEqual([{ name: "Stanisław Lem" }]);
  });

  it("keeps the original order for equal scores", () => {
    const items = [{ name: "Anna B" }, { name: "Anna A" }];
    expect(filterBySearch(items, "anna", (a) => a.name)).toEqual(items);
  });
});
