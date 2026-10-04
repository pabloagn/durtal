import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import { WORK_KINDS } from "@/lib/catalogue/kinds";
import { DOMAIN_ORDER, WORK_DOMAINS } from "@/lib/catalogue/domains";
import { domainSwitchHref } from "@/lib/catalogue/domain-switch";
import { requireEnabledDomain } from "@/lib/catalogue/domain-gate";
import { catalogueDateYears, dateFromColumns } from "@/lib/catalogue/dates";
import {
  DOMAIN_SECTIONS,
  NAV_SECTIONS,
  isSectionActive,
} from "@/lib/navigation";
import { ADD, GO_TO } from "@/lib/shortcuts/shortcuts";
import PerfumesLayout from "@/app/perfumes/layout";
import FilmsLayout from "@/app/films/layout";
import PaintingsLayout from "@/app/paintings/layout";

const UNREADY = ["/perfumes", "/films"];

describe("collection navigation", () => {
  it("lists only the open collections, named after them", () => {
    expect(DOMAIN_SECTIONS).toEqual([
      { href: "/library", label: "Books" },
      { href: "/paintings", label: "Paintings" },
    ]);
    for (const list of [NAV_SECTIONS, GO_TO])
      expect(list.map((entry) => entry.href)).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^\/(perfumes|films)/)]),
      );
    expect(NAV_SECTIONS.slice(0, 3).map((s) => s.label)).toEqual([
      "Dashboard",
      "Books",
      "Paintings",
    ]);
    expect(GO_TO.find((g) => g.href === "/paintings")).toEqual({
      key: "i",
      label: "Paintings",
      href: "/paintings",
    });
    expect(ADD.find((a) => a.section === "/paintings")).toEqual({
      key: "i",
      label: "Painting",
      section: "/paintings",
      href: "/paintings/new",
    });
    expect(GO_TO.find((g) => g.href === "/library")).toEqual({
      key: "l",
      label: "Books",
      href: "/library",
    });
    expect(ADD.find((a) => a.key === "b")).toEqual({
      key: "b",
      label: "Book",
      section: "/library",
      href: "/library/new",
    });
    expect(ADD.some((a) => UNREADY.includes(a.section))).toBe(false);
  });

  it("lists every collection once, in the order of the plan", () => {
    expect(DOMAIN_ORDER).toEqual(["book", "perfume", "film", "painting"]);
    expect([...DOMAIN_ORDER].sort()).toEqual([...WORK_KINDS].sort());
  });

  it("keeps each menu key unique, counting the keys of unready collections", () => {
    const domainHrefs: string[] = WORK_KINDS.map(
      (kind) => WORK_DOMAINS[kind].basePath,
    );
    const goKeys = [
      ...GO_TO.filter((g) => !domainHrefs.includes(g.href)).map((g) => g.key),
      ...WORK_KINDS.map((kind) => WORK_DOMAINS[kind].keys.go),
    ];
    const addKeys = [
      ...ADD.filter((a) => !domainHrefs.includes(a.section)).map((a) => a.key),
      ...WORK_KINDS.map((kind) => WORK_DOMAINS[kind].keys.add),
    ];
    expect(new Set(goKeys).size).toBe(goKeys.length);
    expect(new Set(addKeys).size).toBe(addKeys.length);
  });

  it.each([
    ["/", "/", true],
    ["/", "/library", false],
    ["/library", "/library", true],
    ["/library", "/library/the-cathedral", true],
    ["/library", "/library-old", false],
    ["/places", "/places/shakespeare-and-company", true],
  ])("marks %s active on %s: %s", (href, pathname, active) => {
    expect(isSectionActive(href, pathname)).toBe(active);
  });
});

describe("collection switch", () => {
  const from = (query: string) => new URLSearchParams(query);

  it("keeps the search and a shared sort, and drops book filters and paging", () => {
    expect(
      domainSwitchHref(
        "perfume",
        from("q=rose&status=wanted&publisher=x&sort=rating&order=asc&page=3&perPage=96"),
      ),
    ).toBe("/perfumes?q=rose&sort=rating&order=asc");
  });

  it("drops a sort the destination does not offer, with its order", () => {
    expect(domainSwitchHref("perfume", from("sort=year&order=desc"))).toBe(
      "/perfumes",
    );
    expect(domainSwitchHref("book", from("q=mann&sort=runtime"))).toBe(
      "/library?q=mann",
    );
  });

  it("keeps the destination's own filters and ignores an invalid order", () => {
    expect(
      domainSwitchHref("book", from("status=wanted&sort=recent&order=sideways")),
    ).toBe("/library?status=wanted&sort=recent");
  });
});

describe("collection readiness gate", () => {
  it.each(["book", "painting"] as const)("lets the open %s collection through", (kind) => {
    expect(() => requireEnabledDomain(kind)).not.toThrow();
    expect(() => PaintingsLayout({ children: null })).not.toThrow();
  });

  it.each(["perfume", "film"] as const)(
    "answers 404 for every %s page while the collection is unready",
    (kind) => {
      expect(() => requireEnabledDomain(kind)).toThrow("NEXT_NOT_FOUND");
    },
  );

  it.each([
    ["perfumes", PerfumesLayout],
    ["films", FilmsLayout],
  ])("gates the /%s layout", (_, Layout) => {
    expect(() => Layout({ children: null })).toThrow("NEXT_NOT_FOUND");
  });
});

describe("catalogue years", () => {
  const date = (columns: Partial<Parameters<typeof dateFromColumns>[0]>) =>
    dateFromColumns({
      precision: "year",
      startYear: null,
      startMonth: null,
      startDay: null,
      endYear: null,
      endMonth: null,
      endDay: null,
      approximate: false,
      label: null,
      ...columns,
    });

  it("shows the year of a day, an approximate range and an era", () => {
    expect(
      catalogueDateYears(
        date({ precision: "day", startYear: 1888, startMonth: 7, startDay: 3 }),
      ),
    ).toBe("1888");
    expect(
      catalogueDateYears(
        date({ precision: "range", startYear: 1503, endYear: 1519, approximate: true }),
      ),
    ).toBe("c. 1503–1519");
    expect(catalogueDateYears(date({ startYear: -44 }))).toBe("44 BC");
  });

  it("shows the label of an undated record, or nothing", () => {
    expect(
      catalogueDateYears(date({ precision: "unknown", label: "Undated" })),
    ).toBe("Undated");
    expect(catalogueDateYears(null)).toBeNull();
  });
});
