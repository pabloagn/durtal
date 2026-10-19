import { describe, it, expect } from "vitest";
import {
  filterBySearch,
  isSearchableQuery,
  normalizeSearchText,
  searchScore,
  searchTokens,
  searchWords,
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

  it("drops a NUL character, which Postgres refuses (SLN-1137)", () => {
    expect(normalizeSearchText("nad\u0000ja")).toBe("nadja");
    expect(searchTokens("\u0000")).toEqual([]);
    expect(searchTokens("André\u0000 Breton")).toEqual(["andre", "breton"]);
  });

  it("keeps non-Latin letters", () => {
    expect(normalizeSearchText("Фёдор Достоевский")).toBe("федор достоевскии");
  });

  // SLN-1393: text pasted from a web page or an e-book
  it("drops invisible format characters instead of splitting the word", () => {
    for (const hidden of ["\u00ad", "\u200b", "\u200c", "\u200d", "\u2060", "\ufeff", "\u200e"])
      expect(normalizeSearchText(`Ver${hidden}schwinden`), JSON.stringify(hidden)).toBe("verschwinden");
  });

  it("folds ligatures and fullwidth letters", () => {
    expect(normalizeSearchText("Le ﬁls")).toBe(normalizeSearchText("Le fils"));
    expect(normalizeSearchText("Ｈｕｘｌｅｙ")).toBe("huxley");
    expect(normalizeSearchText("Ｎｉｎｅｔｅｅｎ　Ｅｉｇｈｔｙ－Ｆｏｕｒ")).toBe("nineteen eighty four");
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

// ── searchWords (SLN-1234) ─────────────────────────────────────────────────────

describe("searchWords", () => {
  it("splits on spaces, punctuation and symbols, and folds nothing", () => {
    expect(searchWords("Nádas, Péter")).toEqual(["Nádas", "Péter"]);
    expect(searchWords("Gell-Mann")).toEqual(["Gell", "Mann"]);
    expect(searchWords("한강 猫である Достоевский प्रेमचंद")).toEqual(["한강", "猫である", "Достоевский", "प्रेमचंद"]);
  });

  it("drops what stored text drops, and folds compatibility forms (SLN-1393)", () => {
    expect(searchWords("W. G. Se\u00adbald")).toEqual(["W", "G", "Sebald"]);
    expect(searchWords("\uff28\uff55\uff58\uff4c\uff45\uff59")).toEqual(["Huxley"]);
    // Never a LIKE wildcard: "%" and "_" split words
    expect(searchWords("100%_pure")).toEqual(["100", "pure"]);
  });

  it("drops a NUL character, which Postgres refuses (SLN-1137)", () => {
    expect(searchWords("nad\u0000ja")).toEqual(["nadja"]);
    expect(searchWords("\u0000")).toEqual([]);
  });

  it("composes what was typed decomposed", () => {
    expect(searchWords("\u1112\u1161\u11ab")).toEqual(["한"]);
    expect(searchWords("\u3066\u3099")).toEqual(["で"]);
  });

  it("keeps no symbol-only piece, and no LIKE wildcard", () => {
    expect(searchWords("🦉")).toEqual([]);
    expect(searchWords("%_-")).toEqual([]);
    expect(searchWords("owl🦉")).toEqual(["owl"]);
  });
});

describe("isSearchableQuery", () => {
  it("wants two characters, or one Chinese, Japanese or Korean one", () => {
    expect(isSearchableQuery("a")).toBe(false);
    expect(isSearchableQuery("ab")).toBe(true);
    expect(isSearchableQuery("猫")).toBe(true);
    expect(isSearchableQuery("ね")).toBe(true);
    expect(isSearchableQuery("강")).toBe(true);
  });

  it("searches nothing for symbols alone", () => {
    expect(isSearchableQuery("🦉")).toBe(false);
    expect(isSearchableQuery("🦉🦉")).toBe(false);
    expect(isSearchableQuery("--")).toBe(false);
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

  it("matches nothing for symbols alone, everything for a blank query", () => {
    expect(searchScore("🦉", "Library")).toBe(-1);
    expect(searchScore("  ", "Library")).toBe(0);
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
