import { describe, expect, it } from "vitest";
import {
  REVIEW_SECTIONS,
  reviewSectionsFor,
  type ReviewSectionInput,
} from "@/lib/ebooks/review/sections";

const now = new Date("2026-10-09T20:00:00Z");
const row: ReviewSectionInput = {
  matchState: "pending",
  matchTier: null,
  matchMethod: null,
  matchedAt: null,
  workKind: null,
  catalogueStatus: null,
  activeCopy: false,
};
describe("review section membership", () => {
  it.each(["exact", "strong", "likely"] as const)(
    "keeps unlinked %s visible regardless of blocked effect or auto-link eligibility",
    (matchTier) => {
      expect(reviewSectionsFor({ ...row, matchTier }, now)).toEqual(["likely"]);
    },
  );
  it.each([
    "conflict",
    "to_choose",
    "same_author",
    "duplicate",
    "not_a_book",
    "not_in_durtal",
  ] as const)("shows pending %s exactly once", (matchTier) => {
    expect(reviewSectionsFor({ ...row, matchTier }, now)).toEqual([matchTier]);
  });
  it("shows unclassified pending rows and preserves the prescribed order", () => {
    expect(reviewSectionsFor(row, now)).toEqual(["to_choose"]);
    expect(REVIEW_SECTIONS).toEqual([
      "conflict",
      "likely",
      "to_choose",
      "same_author",
      "duplicate",
      "not_a_book",
      "not_in_durtal",
      "automatic",
      "partially_held",
    ]);
  });
  it.each(["standalone", "excluded"] as const)(
    "hides %s until explicitly restored",
    (matchState) => {
      expect(
        reviewSectionsFor({ ...row, matchState, matchTier: "likely" }, now),
      ).toEqual([]);
    },
  );
  const linked: ReviewSectionInput = {
    ...row,
    matchState: "linked",
    workKind: "book",
    catalogueStatus: "wanted",
    activeCopy: true,
    matchMethod: "isbn",
    matchedAt: now.toISOString(),
  };
  it.each(["isbn", "identifier", "score"] as const)(
    "allows recent %s and partially held membership to overlap",
    (matchMethod) => {
      expect(reviewSectionsFor({ ...linked, matchMethod }, now)).toEqual([
        "automatic",
        "partially_held",
      ]);
    },
  );
  it.each(["wanted", "shortlisted", "tracked", "on_order"])(
    "shows partially held status %s",
    (catalogueStatus) => {
      expect(
        reviewSectionsFor(
          { ...linked, catalogueStatus, matchMethod: "manual" },
          now,
        ),
      ).toEqual(["partially_held"]);
    },
  );
  it("uses one explicit inclusive 30-day boundary, never future or invalid dates", () => {
    const boundary = new Date(now.getTime() - 30 * 86400000);
    expect(
      reviewSectionsFor(
        {
          ...linked,
          catalogueStatus: "accessioned",
          matchedAt: boundary.toISOString(),
        },
        now,
      ),
    ).toEqual(["automatic"]);
    for (const matchedAt of [
      new Date(boundary.getTime() - 1).toISOString(),
      new Date(now.getTime() + 1).toISOString(),
      "2026-10-09T20:00:00.000001Z",
      "invalid",
      null,
    ]) {
      expect(
        reviewSectionsFor(
          { ...linked, catalogueStatus: "accessioned", matchedAt },
          now,
        ),
      ).toEqual([]);
    }
  });
  it.each(["manual", "accession", null] as const)(
    "does not call %s an automatic link",
    (matchMethod) => {
      expect(
        reviewSectionsFor(
          { ...linked, catalogueStatus: "accessioned", matchMethod },
          now,
        ),
      ).toEqual([]);
    },
  );
  it.each(["film", "perfume", "painting", null] as const)(
    "never offers linked non-book kind %s a status mutation",
    (workKind) => {
      expect(reviewSectionsFor({ ...linked, workKind }, now)).toEqual([]);
    },
  );
  it("retains automatic links for Undo but excludes inactive holdings from partially held", () => {
    expect(reviewSectionsFor({ ...linked, activeCopy: false }, now)).toEqual(
      ["automatic"],
    );
    expect(() => reviewSectionsFor(row, new Date(NaN))).toThrow();
  });
});
