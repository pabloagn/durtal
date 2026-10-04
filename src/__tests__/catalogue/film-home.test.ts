import { describe, expect, it } from "vitest";
import {
  creditHeading,
  creditInput,
  filmCreditName,
  filmHoldingsText,
  classificationInput,
  formatRuntime,
  otherClassificationIds,
  parseRuntime,
  readCharacters,
  releaseTerritory,
  runtimeText,
  versionName,
} from "@/lib/catalogue/film-labels";
import { filmQueryFromParams, hasFilmFilters } from "@/lib/catalogue/film-params";
import { domainSwitchHref } from "@/lib/catalogue/domain-switch";
import { filmQuerySchema } from "@/lib/validations/films";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("film runtimes and names", () => {
  it("prints a runtime in hours and minutes, and seconds when it has them", () => {
    expect(formatRuntime(109 * 60)).toBe("1h 49m");
    expect(formatRuntime(58 * 60)).toBe("58m");
    expect(formatRuntime(3600)).toBe("1h");
    expect(formatRuntime(6570)).toBe("1h 49m 30s");
    expect(formatRuntime(null)).toBeNull();
  });

  it("reads a runtime as typed, and gives it back as its field shows it", () => {
    expect(parseRuntime("109")).toBe(6540);
    expect(parseRuntime(" 109 min ")).toBe(6540);
    expect(parseRuntime("1h 49m")).toBe(6540);
    expect(parseRuntime("1H49")).toBe(6540);
    expect(parseRuntime("2h")).toBe(7200);
    expect(parseRuntime("1:49")).toBe(6540);
    expect(parseRuntime("1:49:30")).toBe(6570);
    expect(parseRuntime("")).toBeNull();
    expect(parseRuntime("about two hours")).toBeNaN();
    expect(parseRuntime("1:75")).toBeNaN();
    expect(runtimeText(6540)).toBe("109");
    expect(runtimeText(6570)).toBe("1:49:30");
    expect(runtimeText(null)).toBe("");
  });

  it("names credits, roles, versions, releases and copies with sparse values", () => {
    expect(creditHeading("film.director", 1)).toBe("Director");
    expect(creditHeading("film.director", 2)).toBe("Directors");
    expect(creditHeading("film.story", 2)).toBe("Story");
    expect(filmCreditName({ person: { name: "Kurt Russell" }, creditedAs: "K. Russell", attribution: "unspecified" })).toBe("Kurt Russell");
    expect(filmCreditName({ person: null, creditedAs: "Alan Smithee", attribution: "unspecified" })).toBe("Alan Smithee");
    expect(filmCreditName({ person: null, creditedAs: null, attribution: "anonymous" })).toBe("Anonymous");
    expect(filmCreditName({ person: null, creditedAs: null, attribution: "unknown" })).toBe("Unknown");
    expect(versionName({ label: null })).toBe("Unnamed version");
    expect(versionName({ label: "Director's cut" })).toBe("Director's cut");
    expect(releaseTerritory({ countryName: "France", territoryLabel: null })).toBe("France");
    expect(releaseTerritory({ countryName: null, territoryLabel: "Cannes" })).toBe("Cannes");
    expect(releaseTerritory({ countryName: null, territoryLabel: null })).toBe("Worldwide");
    expect(filmHoldingsText({ physical: 2, digital: 1 })).toBe("2 physical copies, 1 digital copy");
    expect(filmHoldingsText({ physical: 0, digital: 0 })).toBeNull();
  });
});

describe("the film form's classification", () => {
  it("saves its genres and carries the other families' terms unchanged", () => {
    const classification = [
      { itemId: A, familySlug: "film-genres" },
      { itemId: B, familySlug: "mood" },
      { itemId: C, familySlug: "themes" },
    ];
    expect(otherClassificationIds(classification)).toEqual([B, C]);
    expect(classificationInput([A], [B, C])).toEqual([A, B, C]);
    expect(classificationInput([], [B, B])).toEqual([B]);
  });
});

describe("the credits editor's input", () => {
  it("splits characters, keeps them on cast credits only, and records a nameless credit as unknown", () => {
    expect(readCharacters(" Blair / Blair-Thing /  ")).toEqual(["Blair", "Blair-Thing"]);
    const base = { personId: null, name: null, creditedAs: "", characters: "", attribution: "unspecified" as const, notes: null };
    expect(
      creditInput([
        { ...base, key: "a", id: A, personId: B, name: "Kurt Russell", roleId: "film.cast", characters: "MacReady" },
        { ...base, key: "b", roleId: "film.composer", characters: "Ignored" },
        { ...base, key: "c", roleId: "film.director", creditedAs: " Alan Smithee " },
      ]),
    ).toEqual([
      { id: A, personId: B, roleId: "film.cast", creditedAs: null, attribution: "unspecified", characters: ["MacReady"], notes: null },
      { personId: null, roleId: "film.composer", creditedAs: null, attribution: "unknown", characters: [], notes: null },
      { personId: null, roleId: "film.director", creditedAs: "Alan Smithee", attribution: "unspecified", characters: [], notes: null },
    ]);
  });
});

describe("film home URL", () => {
  it("reads every filter, search and sort", () => {
    const query = filmQueryFromParams({
      q: " thing ",
      director: `${A},${B}`,
      cast: A,
      genre: `${B},${C}`,
      language: C,
      country: `${A},${A}`,
      holding: "owned",
      medium: "digital",
      favourite: "1",
      from: "1970",
      to: "1990",
      sort: "runtime",
      order: "asc",
    });
    expect(query).toEqual({
      search: "thing",
      directorIds: [A, B],
      castIds: [A],
      taxonomyItemIds: [B, C],
      languageIds: [C],
      countryIds: [A],
      releaseYearFrom: 1970,
      releaseYearTo: 1990,
      holding: "owned",
      media: ["digital"],
      favourite: true,
      sort: "runtime",
      order: "asc",
    });
    expect(filmQuerySchema.safeParse(query).success).toBe(true);
  });

  it("drops what it cannot read instead of failing", () => {
    const query = filmQueryFromParams({
      director: "not-an-id",
      medium: "vhs",
      holding: "owned,not_owned",
      from: "0",
      to: "abc",
      sort: "house",
      order: "sideways",
    });
    expect(query).toEqual({ holding: "any", sort: "title" });
    expect(filmQuerySchema.safeParse(query).success).toBe(true);
  });

  it("keeps the list query valid when the URL mixes rules", () => {
    // Not owned has no copies; reversed years are put in order
    const query = filmQueryFromParams({ holding: "not_owned", medium: "physical", from: "1990", to: "1970" });
    expect(query).toMatchObject({ holding: "not_owned", releaseYearFrom: 1970, releaseYearTo: 1990 });
    expect(query).not.toHaveProperty("media");
    expect(filmQuerySchema.safeParse(query).success).toBe(true);
  });

  it("tells filters from the search and sort", () => {
    expect(hasFilmFilters({ q: "thing", sort: "runtime" })).toBe(false);
    expect(hasFilmFilters({ cast: A })).toBe(true);
  });

  it("keeps film filters when the switch returns to films, and drops them elsewhere", () => {
    expect(
      domainSwitchHref("film", new URLSearchParams(`director=${A}&genre=${B}&house=${C}&page=2&sort=runtime`)),
    ).toBe(`/films?director=${A}&genre=${B}&sort=runtime`);
    expect(domainSwitchHref("perfume", new URLSearchParams(`director=${A}&q=thing`))).toBe(
      "/perfumes?q=thing",
    );
  });
});
