import { describe, it, expect } from "vitest";
import {
  parseNationalityCodes,
  formatNationalityParam,
  nationalityFilterHref,
  resolveLegacyNationalityNames,
} from "@/lib/utils/nationality-param";

const COUNTRIES = [
  { code: "HU", name: "Hungary, Republic of" },
  { code: "FR", name: "France, French Republic" },
  { code: "JP", name: "Japan" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom of Great Britain & Northern Ireland" },
  { code: "KR", name: "Korea, Republic of" },
  { code: "KP", name: "Korea, Democratic People's Republic of" },
  { code: "NL", name: "Netherlands, Kingdom of the" },
];

// ── parseNationalityCodes ──────────────────────────────────────────────────────

describe("parseNationalityCodes", () => {
  it("returns an empty list for empty input", () => {
    expect(parseNationalityCodes(undefined)).toEqual([]);
    expect(parseNationalityCodes(null)).toEqual([]);
    expect(parseNationalityCodes("")).toEqual([]);
  });

  it("parses a single code", () => {
    expect(parseNationalityCodes("HU")).toEqual(["HU"]);
  });

  it("parses several codes", () => {
    expect(parseNationalityCodes("HU,FR,JP")).toEqual(["HU", "FR", "JP"]);
  });

  it("uppercases, trims and drops empty tokens", () => {
    expect(parseNationalityCodes(" hu , fr ,,")).toEqual(["HU", "FR"]);
  });

  it("removes duplicates", () => {
    expect(parseNationalityCodes("HU,hu,FR,HU")).toEqual(["HU", "FR"]);
  });

  it("returns null for an old name-based value", () => {
    expect(parseNationalityCodes("Hungary, Republic of")).toBeNull();
    expect(parseNationalityCodes("Japan")).toBeNull();
    expect(parseNationalityCodes("HU,Japan")).toBeNull();
  });

  it("returns null for 3-letter codes", () => {
    expect(parseNationalityCodes("HUN")).toBeNull();
  });
});

// ── formatNationalityParam / nationalityFilterHref ─────────────────────────────

describe("formatNationalityParam", () => {
  it("joins codes with commas", () => {
    expect(formatNationalityParam(["HU", "FR"])).toBe("HU,FR");
  });

  it("round-trips through parseNationalityCodes", () => {
    const codes = ["HU", "FR", "KR"];
    expect(parseNationalityCodes(formatNationalityParam(codes))).toEqual(codes);
  });
});

describe("nationalityFilterHref", () => {
  it("builds a link for one code", () => {
    expect(nationalityFilterHref("HU")).toBe("/authors?nationality=HU");
  });

  it("builds a link for several codes", () => {
    expect(nationalityFilterHref(["HU", "FR"])).toBe("/authors?nationality=HU%2CFR");
  });

  it("produces a link that parses back to the same codes", () => {
    const url = new URL(nationalityFilterHref(["HU", "FR"]), "http://localhost");
    expect(parseNationalityCodes(url.searchParams.get("nationality"))).toEqual(["HU", "FR"]);
  });
});

// ── resolveLegacyNationalityNames ──────────────────────────────────────────────

describe("resolveLegacyNationalityNames", () => {
  it("resolves a name that contains a comma (the reported bug)", () => {
    expect(resolveLegacyNationalityNames("Hungary, Republic of", COUNTRIES)).toEqual(["HU"]);
  });

  it("resolves the value exactly as the old URL decoded it", () => {
    const url = new URL("http://localhost/authors?nationality=Hungary%2C%20Republic%20of");
    expect(
      resolveLegacyNationalityNames(url.searchParams.get("nationality")!, COUNTRIES),
    ).toEqual(["HU"]);
  });

  it("resolves several comma names joined by commas", () => {
    expect(
      resolveLegacyNationalityNames("Hungary, Republic of,France, French Republic,Japan", COUNTRIES),
    ).toEqual(["HU", "FR", "JP"]);
  });

  it("prefers the longest matching name", () => {
    expect(
      resolveLegacyNationalityNames("Korea, Democratic People's Republic of,Korea, Republic of", COUNTRIES),
    ).toEqual(["KP", "KR"]);
  });

  it("is case-insensitive and ignores extra spaces", () => {
    expect(resolveLegacyNationalityNames("  hungary ,  republic of ", COUNTRIES)).toEqual(["HU"]);
  });

  it("resolves names with special characters", () => {
    expect(
      resolveLegacyNationalityNames("United Kingdom of Great Britain & Northern Ireland", COUNTRIES),
    ).toEqual(["GB"]);
  });

  it("keeps valid codes mixed with names", () => {
    expect(resolveLegacyNationalityNames("ca,Japan", COUNTRIES)).toEqual(["CA", "JP"]);
  });

  it("drops unknown tokens", () => {
    expect(resolveLegacyNationalityNames("Atlantis,Japan,ZZ", COUNTRIES)).toEqual(["JP"]);
    expect(resolveLegacyNationalityNames("Atlantis", COUNTRIES)).toEqual([]);
  });

  it("removes duplicates", () => {
    expect(resolveLegacyNationalityNames("Japan,Japan,JP", COUNTRIES)).toEqual(["JP"]);
  });
});
