import { describe, it, expect } from "vitest";
import {
  groupMapAuthors,
  isSingleSpot,
  leafFromFeature,
  type MapAuthorLeaf,
} from "@/lib/utils/map-groups";
import { shortCountryName, withNationalityFilter } from "@/lib/utils/nationality-param";

const HU = { lng: 19.5, lat: 47.16 };

function leaf(overrides: Partial<MapAuthorLeaf>): MapAuthorLeaf {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    name: "Someone",
    slug: "someone",
    birthYear: null,
    deathYear: null,
    nationalityCode: "HU",
    nationalityName: "Hungary, Republic of",
    locationName: "Hungary, Republic of",
    longitude: HU.lng,
    latitude: HU.lat,
    ...overrides,
  };
}

// ── isSingleSpot ───────────────────────────────────────────────────────────────

describe("isSingleSpot", () => {
  it("is false for no points", () => {
    expect(isSingleSpot([])).toBe(false);
  });

  it("is true for one point", () => {
    expect(isSingleSpot([{ longitude: 1, latitude: 2 }])).toBe(true);
  });

  it("is true for points on the same centroid", () => {
    expect(isSingleSpot([leaf({}), leaf({}), leaf({})])).toBe(true);
  });

  it("ignores floating point noise", () => {
    expect(
      isSingleSpot([
        { longitude: 19.5, latitude: 47.16 },
        { longitude: 19.5 + 1e-9, latitude: 47.16 - 1e-9 },
      ]),
    ).toBe(true);
  });

  it("is false for points on different spots", () => {
    expect(
      isSingleSpot([leaf({}), leaf({ longitude: 2.2, latitude: 46.2 })]),
    ).toBe(false);
  });
});

// ── leafFromFeature ────────────────────────────────────────────────────────────

describe("leafFromFeature", () => {
  it("reads an author point", () => {
    expect(
      leafFromFeature({
        geometry: { type: "Point", coordinates: [19.5, 47.16] },
        properties: {
          id: "a1",
          name: "Péter Nádas",
          slug: "peter-nadas",
          birthYear: 1942,
          deathYear: null,
          nationalityCode: "HU",
          nationalityName: "Hungary, Republic of",
          locationName: "Hungary, Republic of",
        },
      }),
    ).toEqual({
      id: "a1",
      name: "Péter Nádas",
      slug: "peter-nadas",
      birthYear: 1942,
      deathYear: null,
      nationalityCode: "HU",
      nationalityName: "Hungary, Republic of",
      locationName: "Hungary, Republic of",
      longitude: 19.5,
      latitude: 47.16,
    });
  });

  it("treats the string \"null\" and missing values as null", () => {
    const result = leafFromFeature({
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: { id: "a2", name: "X", slug: "x", birthYear: "null", nationalityCode: "null" },
    });
    expect(result?.birthYear).toBeNull();
    expect(result?.deathYear).toBeNull();
    expect(result?.nationalityCode).toBeNull();
    expect(result?.nationalityName).toBeNull();
  });

  it("reads numbers stored as strings", () => {
    const result = leafFromFeature({
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: { id: "a3", birthYear: "1899", deathYear: "1986" },
    });
    expect(result?.birthYear).toBe(1899);
    expect(result?.deathYear).toBe(1986);
  });

  it("returns null for a cluster feature (no author id)", () => {
    expect(
      leafFromFeature({
        geometry: { type: "Point", coordinates: [0, 0] },
        properties: { cluster: true, cluster_id: 7, point_count: 24 },
      }),
    ).toBeNull();
  });

  it("returns null for a non-point geometry", () => {
    expect(
      leafFromFeature({
        geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
        properties: { id: "a4" },
      }),
    ).toBeNull();
  });
});

// ── groupMapAuthors ────────────────────────────────────────────────────────────

describe("groupMapAuthors", () => {
  it("sorts authors by name", () => {
    const group = groupMapAuthors([
      leaf({ name: "Sándor Márai" }),
      leaf({ name: "Béla Bartók" }),
      leaf({ name: "Magda Szabó" }),
    ]);
    expect(group.authors.map((a) => a.name)).toEqual(["Béla Bartók", "Magda Szabó", "Sándor Márai"]);
  });

  it("groups a country stack into one nationality", () => {
    const group = groupMapAuthors([leaf({}), leaf({}), leaf({})]);
    expect(group.nationalities).toEqual([{ code: "HU", name: "Hungary, Republic of", count: 3 }]);
    expect(group.locationName).toBe("Hungary, Republic of");
  });

  it("orders mixed nationalities by count, then name", () => {
    const fr = { nationalityCode: "FR", nationalityName: "France, French Republic" };
    const de = { nationalityCode: "DE", nationalityName: "Germany, Federal Republic of" };
    const group = groupMapAuthors([leaf(de), leaf(fr), leaf({}), leaf(fr), leaf(de)]);
    expect(group.nationalities.map((n) => [n.code, n.count])).toEqual([
      ["FR", 2],
      ["DE", 2],
      ["HU", 1],
    ]);
  });

  it("leaves authors without a nationality out of the nationality groups", () => {
    const group = groupMapAuthors([leaf({ nationalityCode: null, nationalityName: null }), leaf({})]);
    expect(group.authors).toHaveLength(2);
    expect(group.nationalities).toEqual([{ code: "HU", name: "Hungary, Republic of", count: 1 }]);
  });
});

// ── nationality links used by the map ─────────────────────────────────────────

describe("withNationalityFilter", () => {
  it("sets the nationality and keeps other filters", () => {
    const href = withNationalityFilter(new URLSearchParams("gender=female&q=a&page=3"), "hu");
    const url = new URL(href, "http://localhost");
    expect(url.pathname).toBe("/authors");
    expect(url.searchParams.get("nationality")).toBe("HU");
    expect(url.searchParams.get("gender")).toBe("female");
    expect(url.searchParams.get("q")).toBe("a");
    expect(url.searchParams.get("page")).toBeNull();
  });

  it("replaces an existing nationality filter", () => {
    const href = withNationalityFilter(new URLSearchParams("nationality=FR,DE"), "HU");
    expect(new URL(href, "http://localhost").searchParams.get("nationality")).toBe("HU");
  });
});

describe("shortCountryName", () => {
  it("drops the official suffix", () => {
    expect(shortCountryName("Hungary, Republic of")).toBe("Hungary");
    expect(shortCountryName("Netherlands, Kingdom of the")).toBe("Netherlands");
  });

  it("keeps names without a comma", () => {
    expect(shortCountryName("Japan")).toBe("Japan");
    expect(shortCountryName("United Kingdom of Great Britain & Northern Ireland")).toBe(
      "United Kingdom of Great Britain & Northern Ireland",
    );
  });
});
