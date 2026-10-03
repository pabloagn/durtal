/**
 * Country text to a `countries` row (SLN-330). The table carries formal
 * names ("United States of America", "India, Republic of"), and a match
 * that only "contains" the text picks the wrong row ("United States" →
 * "United States Minor Outlying Islands"). This match is exact: on the
 * table's name, its short form before the comma, the English name of the
 * row's ISO code, and a few common forms ("UK", "USA"). Pure module.
 */
import { normalizeSearchText } from "@/lib/utils/search-text";

export interface CountryRow {
  id: string;
  name: string;
  alpha2: string | null;
}

/** Common forms that no name in the table or the ISO list carries */
const ALIASES: Record<string, string> = {
  uk: "GB",
  "u k": "GB",
  "great britain": "GB",
  britain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  us: "US",
  usa: "US",
  "u s": "US",
  "u s a": "US",
  "united states": "US",
  "united states of america": "US",
  america: "US",
  holland: "NL",
  "the netherlands": "NL",
  russia: "RU",
  "south korea": "KR",
  korea: "KR",
  czechia: "CZ",
  "czech republic": "CZ",
};

const regionName = (() => {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return (code: string) => names.of(code) ?? null;
  } catch {
    return () => null;
  }
})();

const key = (text: string) => normalizeSearchText(text).trim();

/** The countries a text names, in order: "United Kingdom; United States" */
export function splitCountries(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\s*[;/]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** One key → row id map for a list of countries */
export function countryLookup(rows: CountryRow[]): Map<string, string | null> {
  const lookup = new Map<string, string | null>();
  const add = (text: string | null, id: string) => {
    if (!text) return;
    const k = key(text);
    if (!k) return;
    // A key two rows share decides nothing
    lookup.set(k, lookup.has(k) && lookup.get(k) !== id ? null : id);
  };
  const byCode = new Map<string, string>();
  for (const row of rows) {
    add(row.name, row.id);
    add(row.name.split(",")[0], row.id);
    if (row.alpha2) {
      byCode.set(row.alpha2.toUpperCase(), row.id);
      add(regionName(row.alpha2.toUpperCase()), row.id);
    }
  }
  for (const [alias, code] of Object.entries(ALIASES)) {
    const id = byCode.get(code);
    if (id) lookup.set(alias, id);
  }
  return lookup;
}

/**
 * The row for a country text, or null when it names no country or more
 * than one row. With several countries ("United Kingdom/India"), the first
 * is the primary one.
 */
export function resolveCountry(
  text: string | null | undefined,
  lookup: Map<string, string | null>,
): string | null {
  const [primary] = splitCountries(text);
  return primary ? (lookup.get(key(primary)) ?? null) : null;
}
