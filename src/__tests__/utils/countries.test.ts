import { describe, expect, it } from "vitest";
import {
  countryLookup,
  resolveCountry,
  splitCountries,
} from "@/lib/utils/countries";

// The live table's formal names, including the ones a "contains" match hit
const ROWS = [
  { id: "us", name: "United States of America", alpha2: "US" },
  { id: "um", name: "United States Minor Outlying Islands", alpha2: "UM" },
  { id: "in", name: "India, Republic of", alpha2: "IN" },
  { id: "io", name: "British Indian Ocean Territory (Chagos Archipelago)", alpha2: "IO" },
  { id: "gb", name: "United Kingdom of Great Britain & Northern Ireland", alpha2: "GB" },
  { id: "fr", name: "France, French Republic", alpha2: "FR" },
  { id: "kr", name: "Korea, Republic of", alpha2: "KR" },
  { id: "kp", name: "Korea, Democratic People's Republic of", alpha2: "KP" },
  { id: "cz", name: "Czech Republic", alpha2: "CZ" },
  { id: "es", name: "Spain, Kingdom of", alpha2: "ES" },
];
const lookup = countryLookup(ROWS);

describe("country text to its row", () => {
  it.each([
    ["United States", "us"],
    ["USA", "us"],
    ["U.S.A.", "us"],
    ["India", "in"],
    ["United Kingdom", "gb"],
    ["UK", "gb"],
    ["England", "gb"],
    ["France", "fr"],
    ["Spain", "es"],
    ["Czechia", "cz"],
    ["South Korea", "kr"],
    ["North Korea", "kp"],
    ["  united   states ", "us"],
  ])("%s → %s", (text, id) => {
    expect(resolveCountry(text, lookup)).toBe(id);
  });

  it("takes the first country as the primary one", () => {
    expect(resolveCountry("United Kingdom; United States", lookup)).toBe("gb");
    expect(resolveCountry("United Kingdom/India", lookup)).toBe("gb");
    expect(splitCountries("United States; Italy")).toEqual(["United States", "Italy"]);
  });

  it("links nothing it cannot name exactly", () => {
    expect(resolveCountry("United", lookup)).toBeNull();
    expect(resolveCountry("Minor Islands", lookup)).toBeNull();
    expect(resolveCountry("Narnia", lookup)).toBeNull();
    expect(resolveCountry(null, lookup)).toBeNull();
    expect(resolveCountry("", lookup)).toBeNull();
  });
});
