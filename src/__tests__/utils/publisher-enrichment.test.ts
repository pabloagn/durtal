import { describe, expect, it } from "vitest";
import {
  aboutText,
  describedCountries,
  isbnCountries,
  nameRank,
  planHouse,
  searchTexts,
  sourcePayloadHash,
  type HouseEvidence,
} from "@/lib/publishers/enrichment";
import { createHash } from "node:crypto";
import { stableStringify } from "@/lib/harmonization/normalize";
import { countryLookup } from "@/lib/utils/countries";
import type { WikidataItem } from "@/lib/publishers/wikidata";

const ROWS = [
  { id: "us", name: "United States of America", alpha2: "US" },
  { id: "gb", name: "United Kingdom of Great Britain & Northern Ireland", alpha2: "GB" },
  { id: "fr", name: "France, French Republic", alpha2: "FR" },
  { id: "es", name: "Spain, Kingdom of", alpha2: "ES" },
];
const lookup = countryLookup(ROWS);
const alpha2Of = (id: string) => ROWS.find((r) => r.id === id)?.alpha2 ?? null;

const item = (id: string, over: Partial<WikidataItem>): WikidataItem => ({
  id,
  label: null,
  description: null,
  aliases: [],
  classes: ["Q2085381"],
  superclasses: [],
  countries: [],
  alpha2: null,
  headquarters: [],
  founded: null,
  dissolved: null,
  websites: [],
  parents: [],
  enwiki: null,
  ...over,
});
const items: Record<string, WikidataItem> = {
  Q30: item("Q30", { label: "United States", alpha2: "US", classes: [] }),
  Q145: item("Q145", { label: "United Kingdom", alpha2: "GB", classes: [] }),
  Q142: item("Q142", { label: "France", alpha2: "FR", classes: [] }),
  Q23436: item("Q23436", { label: "Edinburgh", classes: [] }),
  Q60: item("Q60", { label: "New York City", classes: [] }),
  QPRH: item("QPRH", { label: "Penguin Random House", classes: [] }),
};
const house = (over: Partial<HouseEvidence>): HouseEvidence => ({
  id: "h",
  name: "Canongate",
  kind: "publisher",
  country: null,
  countryId: null,
  website: null,
  description: null,
  parent: null,
  grandparent: null,
  aliases: [],
  editions: [],
  ...over,
});
const plan = (h: HouseEvidence, candidates: WikidataItem[]) =>
  planHouse(h, {
    candidates,
    items,
    publisherClasses: new Set(["Q2085381"]),
    countryLookup: lookup,
    alpha2Of,
  });

const canongate = item("Q5033341", {
  label: "Canongate Books",
  description: "publishing firm based in Edinburgh, Scotland",
  countries: ["Q145"],
  headquarters: ["Q23436"],
  founded: 1973,
  websites: ["http://canongate.co.uk", "https://canongate.co.uk"],
});

describe("matching a house to Wikidata", () => {
  it("takes a publisher whose name fits and whose country agrees", () => {
    const p = plan(house({ country: "United Kingdom" }), [canongate]);
    expect(p.match).toMatchObject({ id: "Q5033341", confidence: "high" });
    expect(p.fill).toEqual({
      website: "https://canongate.co.uk",
      description: "Publishing firm based in Edinburgh, Scotland. Founded in 1973.",
    });
  });

  it("never takes something that is not a publisher", () => {
    const area = item("Q64947484", { label: "Canongate", classes: ["Q_AREA"], countries: ["Q145"] });
    expect(plan(house({}), [area]).match).toBeNull();
  });

  it("leaves a house alone when Wikidata names another country", () => {
    const p = plan(house({ country: "France" }), [canongate]);
    expect(p.match).toBeNull();
    expect(p.conflicts[0]).toMatch(/GB; the catalogue says France/);
  });

  it("holds a match its books contradict", () => {
    const books = [
      { isbn: null, country: "France" },
      { isbn: null, country: "France" },
    ];
    const p = plan(house({ editions: books }), [canongate]);
    expect(p.match).toBeNull();
    expect(p.held[0]).toMatch(/published in FR/);
  });

  it("fills the country of the only publisher with the same name, as medium", () => {
    const p = plan(house({ name: "Canongate Books" }), [canongate]);
    expect(p.match?.confidence).toBe("medium");
    expect(p.fill.country).toBe("United Kingdom");
  });

  it("holds a match that rests on a similar name only", () => {
    const similar = item("Q1", { label: "Canongate Press", countries: ["Q145"] });
    const p = plan(house({}), [similar]);
    expect(p.match).toBeNull();
    expect(p.held[0]).toMatch(/only a similar name/);
  });

  it("picks the item with the same parent house among same-name ones", () => {
    const us = item("Q3560313", { label: "Vintage Books", countries: ["Q30"], parents: ["QPRH"], headquarters: ["Q60"] });
    const other = item("Q9", { label: "Vintage Books", countries: ["Q30"] });
    const p = plan(
      house({ name: "Vintage Books", parent: "Knopf Doubleday Publishing Group", grandparent: "Penguin Random House" }),
      [other, us],
    );
    expect(p.match?.id).toBe("Q3560313");
    expect(p.evidence).toContain("same parent house");
  });

  it("holds when several same-name publishers fit", () => {
    const a = item("Qa", { label: "Atlas" });
    const b = item("Qb", { label: "Atlas" });
    expect(plan(house({ name: "Atlas" }), [a, b]).held[0]).toMatch(/2 Wikidata items fit/);
  });
});

describe("rules found in review", () => {
  it("never takes an item through a stray alias alone", () => {
    const dell = item("Q2075464", {
      label: "Dell Publishing",
      aliases: ["Random House Publishing Group"],
      countries: ["Q30"],
    });
    const p = plan(
      house({ name: "Penguin Random House", aliases: ["Random House"], country: "United States" }),
      [dell],
    );
    expect(p.match).toBeNull();
  });

  it("matches names written without a space or with a short form", () => {
    expect(nameRank({ name: "AKPress", aliases: [] }, { label: "AK Press", aliases: [] })).toBe(4);
    expect(
      nameRank({ name: "U of Minnesota Press", aliases: [] }, { label: "University of Minnesota Press", aliases: [] }),
    ).toBe(4);
  });

  it("takes a business whose description says it publishes, when the name matches", () => {
    const akashic = item("Q4033640", {
      label: "Akashic Books",
      classes: ["Q_BUSINESS"],
      description: "American independent book publisher",
    });
    const p = plan(house({ name: "Akashic Books", country: "United States" }), [akashic]);
    expect(p.match?.id).toBe("Q4033640");
  });

  it("ranks the house's own name above its aliases", () => {
    const h = { name: "Penguin Random House", aliases: ["Random House"] };
    expect(nameRank(h, { label: "Penguin Random House", aliases: [] })).toBe(4);
    expect(nameRank(h, { label: "Random House", aliases: [] })).toBe(3);
    expect(nameRank(h, { label: "Dell Publishing", aliases: ["Random House Publishing Group"] })).toBe(0);
  });

  it("reads a country from the description when Wikidata has no country", () => {
    expect(describedCountries("American publisher")).toEqual(["US"]);
    expect(describedCountries("English private press")).toEqual(["GB"]);
    expect(describedCountries("Anglo-American publishing house")).toEqual([]);
    const classics = item("Q7932818", { label: "Vintage Classics", description: "American publisher" });
    const p = plan(house({ name: "Vintage Classics", country: "United Kingdom" }), [classics]);
    expect(p.match).toBeNull();
    expect(p.conflicts[0]).toMatch(/US; the catalogue says United Kingdom/);
  });

  it("lets a stated country outrank where most copies were printed", () => {
    const prh = item("Q2908540", { label: "Penguin Random House", countries: ["Q30"] });
    const books = [1, 2, 3].map(() => ({ isbn: null, country: "United Kingdom" }));
    const p = plan(
      house({ name: "Penguin Random House", country: "United Kingdom; United States", editions: books }),
      [prh],
    );
    expect(p.match?.id).toBe("Q2908540");
  });

  it("follows a review over the rules", () => {
    const a = item("Qa", { label: "Atlas" });
    const b = item("Qb", { label: "Atlas" });
    const accepted = planHouse(house({ name: "Atlas" }), {
      candidates: [a, b],
      items,
      publisherClasses: new Set(["Q2085381"]),
      countryLookup: lookup,
      alpha2Of,
      review: { accept: "Qb", note: "the London press" },
    });
    expect(accepted.match?.id).toBe("Qb");
    const rejected = planHouse(house({ name: "Atlas" }), {
      candidates: [a],
      items,
      publisherClasses: new Set(["Q2085381"]),
      countryLookup: lookup,
      alpha2Of,
      review: { reject: true, note: "not this one" },
    });
    expect(rejected.match).toBeNull();
  });

  it("never takes a person, and prefers items filed as publishers", () => {
    const person = item("Q24844360", { label: "Peter Owen", classes: ["Q5"], description: "British publisher" });
    const firm = item("Q7176251", { label: "Peter Owen Publishers", countries: ["Q145"] });
    const p = plan(house({ name: "Peter Owen", country: "United Kingdom" }), [person, firm]);
    expect(p.match?.id).toBe("Q7176251");
    const described = item("Q1", { label: "Open Letter", classes: ["Q_GENRE"], description: "letter published openly" });
    const press = item("Q2", { label: "Open Letter Books", countries: ["Q30"] });
    expect(plan(house({ name: "Open Letter", country: "United States" }), [described, press]).match?.id).toBe("Q2");
  });

  it("rules out a house that closed before its books came out", () => {
    const old = item("Q18428142", { label: "Minerva Press", countries: ["Q145"], founded: 1790, dissolved: 1820 });
    const books = [{ isbn: null, country: "United Kingdom", year: 1991 }];
    const p = plan(house({ name: "Minerva", country: "United Kingdom", editions: books }), [old]);
    expect(p.match).toBeNull();
    expect(p.held[0]).toMatch(/closed in 1820; its books came out until 1991/);
  });

  it("keeps the description's own founding and place, and corrects known typos", () => {
    const facts = {
      label: "X", description: "British multinational academic publisher founded in 1836", countries: [],
      founded: 1851, dissolved: null, headquarters: "London", website: null, parents: [], enwiki: null,
    };
    expect(aboutText(facts)).toBe("British multinational academic publisher founded in 1836. Based in London.");
    expect(aboutText({ ...facts, description: "Book publisher based in New York", founded: 1996, headquarters: "New York City" }))
      .toBe("Book publisher based in New York. Founded in 1996.");
    expect(aboutText({ ...facts, description: "Imprint of Penguine Random House", founded: null, headquarters: null }))
      .toBe("Imprint of Penguin Random House.");
  });

  it("leaves a one-word description out of the About text", () => {
    const facts = {
      label: "X", description: "publisher", countries: [], founded: 2012, dissolved: null,
      headquarters: null, website: null, parents: [], enwiki: null,
    };
    expect(aboutText(facts)).toBe("Founded in 2012.");
    expect(aboutText({ ...facts, founded: null })).toBeNull();
  });
});

describe("evidence helpers", () => {
  it("knows the countries of an ISBN registration group", () => {
    expect(isbnCountries("9780374100148", lookup, alpha2Of)).toContain("US");
    expect(isbnCountries("9782070360024", lookup, alpha2Of)).toContain("FR");
    expect(isbnCountries("9788433920423", lookup, alpha2Of)).toEqual(["ES"]);
    expect(isbnCountries(null, lookup, alpha2Of)).toBeNull();
  });

  it("builds the About text from facts, without repeating the place", () => {
    expect(
      aboutText({
        label: "X",
        description: "American publisher",
        countries: ["US"],
        founded: 1946,
        dissolved: 1990,
        headquarters: "New York City",
        website: null,
        parents: [],
        enwiki: null,
      }),
    ).toBe("American publisher. Founded in 1946. It was based in New York City. Closed in 1990.");
    expect(
      aboutText({
        label: "X", description: "Anglo-American publishing house", countries: [], founded: 1817,
        dissolved: null, headquarters: "195 Broadway", website: null, parents: [], enwiki: null,
      }),
    ).toBe("Anglo-American publishing house. Founded in 1817.");
  });

  it("searches the name, its bare form, the inside of parentheses and the aliases", () => {
    expect(
      searchTexts({ name: "New York Review Books (NYRB)", aliases: ["New York Review of Books"] }),
    ).toEqual([
      "New York Review Books (NYRB)",
      "New York Review Books",
      "NYRB",
      "New York Review of Books",
      "New York Review",
    ]);
    // Wikidata's search matches the start of a label: short forms too
    expect(searchTexts({ name: "Tin House Books", aliases: [] })).toEqual(["Tin House Books", "Tin House"]);
    expect(searchTexts({ name: "Dedalus", aliases: [] })).toEqual(["Dedalus", "Dedalus Books", "Dedalus Press"]);
  });
});

describe("source record hash", () => {
  it("follows the sorted-key rule, whatever the key order", () => {
    const a = { runId: "r", label: "Canongate Books", countries: ["GB"], founded: 1973 };
    const b = { founded: 1973, countries: ["GB"], label: "Canongate Books", runId: "r" };
    expect(sourcePayloadHash(a)).toBe(sourcePayloadHash(b));
    expect(sourcePayloadHash(a)).toBe(createHash("sha256").update(stableStringify(b)).digest("hex"));
    expect(sourcePayloadHash(a)).not.toBe(createHash("sha256").update(JSON.stringify(b)).digest("hex"));
  });
});
