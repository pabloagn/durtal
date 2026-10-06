import { describe, expect, it } from "vitest";
import { bookFiltersSchema, hasBookFilters, parseBookFilters } from "@/lib/library/filter-params";

// The library's book filters from the URL (SLN-405)

const ID = "6f1c1f8e-2b6a-4f3e-9d6c-1a2b3c4d5e6f";
const ID2 = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const parse = (query: string) => parseBookFilters(new URLSearchParams(query));

describe("parseBookFilters", () => {
  it("reads every filter", () => {
    const { filters, issues } = parse(
      `mark=rare,favourite&publisher=${ID}&priority=high&rating=4.5&location=${ID},${ID2}&format=ebook,hardcover` +
        `&copy=signed&lang=fr,pt-BR&origLang=es&yearFrom=1850&yearTo=1920&series=in&subject=${ID}&category=${ID2}` +
        `&color=red,black&poster=missing`,
    );
    expect(issues).toEqual([]);
    expect(filters).toEqual({
      marks: ["rare", "favourite"],
      publisherIds: [ID],
      acquisitionPriority: ["high"],
      minRating: 4.5,
      locationIds: [ID, ID2],
      formats: ["ebook", "hardcover"],
      copyFlags: ["signed"],
      languages: ["fr", "pt-BR"],
      originalLanguages: ["es"],
      yearFrom: 1850,
      yearTo: 1920,
      series: "in",
      taxonomy: { subject: [ID], category: [ID2] },
      colors: ["red", "black"],
      hasPoster: false,
    });
    // The page's parsed filters pass the timeline's check unchanged
    expect(bookFiltersSchema.parse(filters)).toEqual(filters);
    expect(hasBookFilters(filters)).toBe(true);
  });

  it("keeps the valid values and reports the rest under their parameter", () => {
    const { filters, issues } = parse("color=red,teal,red&format=scroll&location=nope&rating=4.2&lang=f%20r");
    expect(filters).toEqual({ colors: ["red"] });
    expect(issues.map((i) => String(i.path[0])).sort()).toEqual(["color", "format", "lang", "location", "rating"]);
  });

  it("reads the old rare link, swaps reversed years and drops a series or picture choice that cancels out", () => {
    expect(parse("rare=true").filters).toEqual({ marks: ["rare"] });
    expect(parse("rare=true&mark=rare").filters).toEqual({ marks: ["rare"] });
    expect(parse("yearFrom=1950&yearTo=1900").filters).toEqual({ yearFrom: 1900, yearTo: 1950 });
    expect(parse("series=in,none&poster=has,missing").filters).toEqual({});
  });

  it("has no filter when nothing is chosen", () => {
    expect(hasBookFilters(parse("q=dune&sort=title").filters)).toBe(false);
  });
});
