import { describe, it, expect } from "vitest";
import { huntAssessmentSchema } from "@/lib/validations/hunting";
import { localToday } from "@/lib/constants/hunting";

describe("hunting assessments", () => {
  it("accepts both markers with an explicit calendar date", () => {
    for (const huntDifficulty of ["rare", "difficult_to_hunt"]) {
      expect(
        huntAssessmentSchema.safeParse({
          huntDifficulty,
          huntAssessedOn: "2024-02-29",
        }).success,
      ).toBe(true);
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
      huntAssessmentSchema.safeParse({ huntDifficulty: "rare", huntAssessedOn })
        .success,
    ).toBe(false);
  });
  it("clears both fields and rejects orphan dates or unrelated updates", () => {
    expect(
      huntAssessmentSchema.safeParse({
        huntDifficulty: null,
        huntAssessedOn: null,
      }).success,
    ).toBe(true);
    expect(
      huntAssessmentSchema.safeParse({
        huntDifficulty: null,
        huntAssessedOn: "2026-01-01",
      }).success,
    ).toBe(false);
    expect(
      huntAssessmentSchema.safeParse({
        huntDifficulty: "rare",
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
