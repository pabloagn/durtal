import { describe, expect, it } from "vitest";
import {
  formatPrice,
  formatVolume,
  formulationName,
  holdingsSummary,
  notesByPosition,
  remainingShare,
} from "@/lib/catalogue/perfume-labels";
import {
  hasPerfumeFilters,
  perfumeQueryFromParams,
} from "@/lib/catalogue/perfume-params";
import { domainSwitchHref } from "@/lib/catalogue/domain-switch";
import { perfumeQuerySchema } from "@/lib/validations/perfumes";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("perfume names and amounts", () => {
  it("names a formulation as people say it, with sparse values", () => {
    expect(
      formulationName({ concentration: "eau_de_parfum", concentrationLabel: null }),
    ).toBe("Eau de Parfum");
    expect(
      formulationName({
        concentration: "eau_de_parfum",
        concentrationLabel: "Intense",
        formulationLabel: "2010 reformulation",
      }),
    ).toBe("Eau de Parfum Intense · 2010 reformulation");
    expect(
      formulationName(
        { concentration: "eau_de_toilette", concentrationLabel: null },
        { short: true },
      ),
    ).toBe("EDT");
    expect(
      formulationName({ concentration: "other", concentrationLabel: "Hair mist" }),
    ).toBe("Hair mist");
    expect(
      formulationName({ concentration: null, concentrationLabel: null }),
    ).toBe("Unknown concentration");
  });

  it("prints volumes, holdings and prices", () => {
    expect(formatVolume(75)).toBe("75 ml");
    expect(formatVolume(1.5, "l")).toBe("1.5 l");
    expect(formatVolume(0.001)).toBe("0.001 ml");
    expect(holdingsSummary({ bottle: 2, sample: 1, decant: 0 })).toBe(
      "2 bottles, 1 sample",
    );
    expect(holdingsSummary({ bottle: 0, sample: 0, decant: 0 })).toBeNull();
    expect(formatPrice(120, "EUR")).toBe("€120.00");
    expect(formatPrice(9800, "JPY")).toBe("¥9,800");
  });

  it("groups notes by position in pyramid order, keeping their order", () => {
    const groups = notesByPosition([
      { name: "vanilla", position: "base" as const },
      { name: "bergamot", position: "top" as const },
      { name: "iris", position: "heart" as const },
      { name: "lemon", position: "top" as const },
      { name: "musk", position: null },
    ]);
    expect(groups.map((g) => [g.position, g.notes.map((n) => n.name)])).toEqual([
      ["top", ["bergamot", "lemon"]],
      ["heart", ["iris"]],
      ["base", ["vanilla"]],
      ["unspecified", ["musk"]],
    ]);
  });

  it("measures what is left only when it is known", () => {
    expect(remainingShare(50, 100)).toBe(0.5);
    expect(remainingShare(null, 100)).toBeNull();
    expect(remainingShare(120, 100)).toBe(1);
  });
});

describe("perfume home URL", () => {
  it("reads every filter into one valid list query", () => {
    const query = perfumeQueryFromParams({
      q: " rose ",
      house: `${A},${B}`,
      perfumer: A,
      family: B,
      accord: C,
      note: A,
      concentration: "eau_de_parfum,extrait",
      holding: "owned",
      container: "sample",
      favourite: "1",
      from: "1990",
      to: "2010",
      sort: "release",
      order: "asc",
    });
    expect(query).toEqual({
      search: "rose",
      houseIds: [A, B],
      perfumerIds: [A],
      taxonomyItemIds: [B, C, A],
      concentrations: ["eau_de_parfum", "extrait"],
      releaseYearFrom: 1990,
      releaseYearTo: 2010,
      holding: "owned",
      containers: ["sample"],
      favourite: true,
      sort: "release",
      order: "asc",
    });
    expect(perfumeQuerySchema.safeParse(query).success).toBe(true);
  });

  it("drops what it cannot read instead of failing", () => {
    const query = perfumeQueryFromParams({
      house: "not-an-id",
      concentration: "eau_de_vie",
      holding: "owned,not_owned",
      from: "0",
      to: "abc",
      sort: "runtime",
      order: "sideways",
    });
    expect(query).toEqual({ holding: "any", sort: "title" });
    expect(perfumeQuerySchema.safeParse(query).success).toBe(true);
  });

  it("keeps the list query valid when the URL mixes rules", () => {
    // Not owned has no containers; reversed years are put in order
    const query = perfumeQueryFromParams({
      holding: "not_owned",
      container: "bottle",
      from: "2010",
      to: "1990",
    });
    expect(query).toMatchObject({
      holding: "not_owned",
      releaseYearFrom: 1990,
      releaseYearTo: 2010,
    });
    expect(query).not.toHaveProperty("containers");
    expect(perfumeQuerySchema.safeParse(query).success).toBe(true);
  });

  it("tells filters from the search and sort", () => {
    expect(hasPerfumeFilters({ q: "rose", sort: "rating" })).toBe(false);
    expect(hasPerfumeFilters({ note: A })).toBe(true);
  });

  it("keeps perfume filters when the switch returns to perfumes", () => {
    expect(
      domainSwitchHref(
        "perfume",
        new URLSearchParams(`house=${A}&note=${B}&status=wanted&page=2`),
      ),
    ).toBe(`/perfumes?house=${A}&note=${B}`);
    expect(
      domainSwitchHref("book", new URLSearchParams(`house=${A}&q=iris`)),
    ).toBe("/library?q=iris");
  });
});
