import { describe, expect, it } from "vitest";
import { formatRating, parseRatingParam } from "@/lib/utils/rating";
import { RATING_SCHEMA } from "@/lib/validations/helpers";
import { updateWorkSchema } from "@/lib/validations/works";
import { curationPatchSchema } from "@/lib/catalogue/curation";
import { createVenueSchema } from "@/lib/validations/venues";
import { workFormValues, workPayload } from "@/components/books/work-form";

describe("formatRating", () => {
  it("writes whole and half stars without a trailing zero", () => {
    expect(formatRating(4)).toBe("4");
    expect(formatRating(4.5)).toBe("4.5");
    expect(formatRating("4.0")).toBe("4");
    expect(formatRating(null)).toBe("");
    expect(formatRating(undefined)).toBe("");
  });
});

describe("parseRatingParam", () => {
  it("keeps a half step and drops anything else", () => {
    expect(parseRatingParam("4.5")).toBe(4.5);
    expect(parseRatingParam("3")).toBe(3);
    expect(parseRatingParam("4.3")).toBeUndefined();
    expect(parseRatingParam("x")).toBeUndefined();
    expect(parseRatingParam(null)).toBeUndefined();
  });
});

describe("work rating validation", () => {
  it("accepts 4.5 and refuses 4.3 and 0 for books and the other collections", () => {
    for (const schema of [RATING_SCHEMA, updateWorkSchema.shape.rating, curationPatchSchema.shape.rating]) {
      expect(schema.safeParse(4.5).success).toBe(true);
      expect(schema.safeParse(4.3).success).toBe(false);
      expect(schema.safeParse(0).success).toBe(false);
      expect(schema.safeParse(null).success).toBe(true);
    }
  });
  it("keeps venue ratings whole", () => {
    expect(createVenueSchema.safeParse({ name: "Shop", type: "bookshop", personalRating: 4 }).error?.issues.find((i) => i.path[0] === "personalRating")).toBeUndefined();
    expect(createVenueSchema.safeParse({ name: "Shop", type: "bookshop", personalRating: 4.5 }).error?.issues.find((i) => i.path[0] === "personalRating")).toBeDefined();
  });
});

describe("the Edit Work form", () => {
  it("keeps a half-star rating through an unrelated save", () => {
    const work = {
      title: "Watt", originalLanguage: "en", originalYear: null, workTypeId: null, isAnthology: false,
      catalogueStatus: "accessioned", acquisitionPriority: "none", rating: 3.5, description: null, notes: null,
      seriesName: null, seriesId: null, seriesPosition: null,
    };
    const values = workFormValues(work, [], [{ id: "00000000-0000-4000-8000-000000000001", name: "Samuel Beckett", role: "author" }]);
    const payload = workPayload({ ...values, notes: "Reread" });
    expect(payload.ok && payload.input.rating).toBe(3.5);
    expect(payload.ok && updateWorkSchema.shape.rating.safeParse(payload.input.rating).success).toBe(true);
  });
});
