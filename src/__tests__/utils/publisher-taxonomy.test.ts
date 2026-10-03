import { describe, expect, it } from "vitest";
import { isbnPrefix } from "@/lib/publishers/names";
import {
  TAXONOMY,
  flattenTaxonomy,
  planEdition,
  prefixDigits,
  type HouseSpec,
} from "@/lib/publishers/taxonomy";

function evidence(
  isbn: string,
  publishers: string[],
  series: string[] = [],
  places: string[] = [],
) {
  return {
    isbn,
    prefix: isbnPrefix(isbn)?.label ?? null,
    publishers,
    series,
    places,
  };
}
const pick = (...args: Parameters<typeof evidence>) =>
  planEdition(evidence(...args)).house?.spec.name ?? null;

describe("taxonomy structure", () => {
  const houses = flattenTaxonomy();
  it("follows group → publisher → imprint", () => {
    const parentOf = new Map(houses.map((h) => [h.spec.name, h.parent]));
    const kindOf = new Map(houses.map((h) => [h.spec.name, h.spec.kind]));
    for (const h of houses) {
      const parentKind = h.parent ? kindOf.get(h.parent) : null;
      if (h.spec.kind === "group") expect(h.parent, h.spec.name).toBeNull();
      if (h.spec.kind === "publisher")
        expect([null, "group"]).toContain(parentKind ?? null);
      if (h.spec.kind === "imprint")
        expect(parentKind, h.spec.name).toBe("publisher");
    }
    expect(parentOf.get("Vintage Books")).toBe(
      "Knopf Doubleday Publishing Group",
    );
    expect(parentOf.get("Vintage")).toBe("Vintage Publishing");
  });

  it("gives every name, alias and ISBN prefix to one house only", () => {
    const seen = new Map<string, string>();
    const own = (key: string, house: string) => {
      const earlier = seen.get(key);
      // Same-name imprints of two companies share their spellings on purpose
      if (earlier && !["vintage", "vintage books"].includes(key))
        throw new Error(`${key}: ${earlier} and ${house}`);
      seen.set(key, house);
    };
    for (const h of houses) {
      for (const n of [h.spec.name, ...(h.spec.aliases ?? [])])
        own(n.toLowerCase(), h.spec.name);
      for (const p of h.spec.prefixes ?? []) own(prefixDigits(p), h.spec.name);
    }
    expect(seen.size).toBeGreaterThan(50);
  });

  it("puts ISBN prefixes on publishers and groups, never on imprints", () => {
    const imprints = (s: HouseSpec[]): HouseSpec[] =>
      s.flatMap((h) => [
        ...(h.kind === "imprint" ? [h] : []),
        ...imprints(h.children ?? []),
      ]);
    for (const i of imprints(TAXONOMY))
      expect(i.prefixes, i.name).toBeUndefined();
  });
});

describe("imprint evidence from Open Library", () => {
  it.each([
    ["Running Dog", "9780679722946", ["Vintage"], [], "Vintage Books"],
    [
      "First Love",
      "9780140443356",
      ["Penguin Classics"],
      [],
      "Penguin Classics",
    ],
    [
      "The Stranger",
      "9780679720201",
      ["Vintage International"],
      [],
      "Vintage International",
    ],
    [
      "Dead Souls",
      "9780140448078",
      ["PENGUIN BOOKS"],
      ["PENGUIN CLASSICS"],
      "Penguin Classics",
    ],
    ["a UK Vintage book", "9780099285830", ["Vintage"], [], "Vintage"],
    [
      "a Modern Library book on a Knopf prefix",
      "9780375759239",
      ["Modern Library"],
      [],
      "The Modern Library",
    ],
    [
      "a Penguin book with only its publisher",
      "9780140186246",
      ["Penguin Books"],
      ["Penguin twentieth-century classics"],
      "Penguin Books",
    ],
  ])("%s → %s", (_, isbn, publishers, series, house) => {
    expect(pick(isbn, publishers, series)).toBe(house);
  });

  it("refuses an imprint whose company does not hold the ISBN", () => {
    const plan = planEdition(evidence("9780060883287", ["Penguin Classics"]));
    expect(plan.house).toBeNull();
    expect(plan.refused).toMatch(/belongs to another publisher/);
  });

  it("finds the market from the place, else from a one-market prefix", () => {
    expect(
      planEdition(evidence("9780140186246", [], [], ["New York"])).market,
    ).toBe("United States");
    expect(
      planEdition(evidence("9780140448078", [], [], ["LONDON"])).market,
    ).toBe("United Kingdom");
    expect(planEdition(evidence("9780241341544", [], [])).market).toBe(
      "United Kingdom",
    );
    // 978-0-14 is used in both markets
    expect(planEdition(evidence("9780140443356", [], [])).market).toBeNull();
    // A place that contradicts the prefix decides nothing
    expect(
      planEdition(evidence("9780241341544", [], [], ["New York"])).market,
    ).toBeNull();
  });
});

describe("same-name imprints on a prefix the group shares", () => {
  it("takes the imprint of the book's market", () => {
    // 978-0-525 belongs to Penguin Random House as a whole
    expect(pick("9780525564454", ["Vintage"], [], ["New York"])).toBe(
      "Vintage Books",
    );
    expect(pick("9780525564454", ["Vintage"])).toBe("Vintage Books");
  });
});
