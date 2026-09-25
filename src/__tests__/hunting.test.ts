import { describe, it, expect } from "vitest";
import { huntAssessmentSchema } from "@/lib/validations/hunting";
import { localToday } from "@/lib/constants/hunting";

describe("hunting assessments", () => {
  it("accepts a boolean flag with an explicit calendar date", () => {
    expect(
      huntAssessmentSchema.safeParse({
        isRare: true,
        huntAssessedOn: "2024-02-29",
      }).success,
    ).toBe(true);
    for (const isRare of ["rare", "difficult_to_hunt", "true", null]) {
      expect(
        huntAssessmentSchema.safeParse({ isRare, huntAssessedOn: "2024-02-29" })
          .success,
      ).toBe(false);
    }
  });
  it.each([
    "",
    "2025-02-29",
    "2026-04-31",
    "2026-01-01T00:00:00Z",
    null,
    undefined,
  ])("rejects missing or impossible dates: %s", (huntAssessedOn) => {
    expect(
      huntAssessmentSchema.safeParse({ isRare: true, huntAssessedOn }).success,
    ).toBe(false);
  });
  it("clears both fields and rejects orphan dates or unrelated updates", () => {
    expect(
      huntAssessmentSchema.safeParse({
        isRare: false,
        huntAssessedOn: null,
      }).success,
    ).toBe(true);
    expect(
      huntAssessmentSchema.safeParse({
        isRare: false,
        huntAssessedOn: "2026-01-01",
      }).success,
    ).toBe(false);
    expect(
      huntAssessmentSchema.safeParse({
        isRare: true,
        huntAssessedOn: "2026-01-01",
        catalogueStatus: "accessioned",
      }).success,
    ).toBe(false);
  });
  it("uses local calendar components, including around midnight", () => {
    expect(localToday(new Date(2026, 0, 1, 0, 15))).toBe("2026-01-01");
    expect(localToday(new Date(2026, 11, 31, 23, 55))).toBe("2026-12-31");
  });
});
