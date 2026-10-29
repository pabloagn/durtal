import { describe, expect, it } from "vitest";
import { reviewSummary } from "@/lib/ebooks/review-queue/summary";
import { REVIEW_SECTIONS, type ReviewQueue } from "@/lib/ebooks/review-queue/types";
const counts = (values: Partial<ReviewQueue["counts"]>) => ({
  ...Object.fromEntries(REVIEW_SECTIONS.map(({ key }) => [key, 0])), ...values,
}) as ReviewQueue["counts"];
describe("review summary", () => {
  it("omits empty parts and uses one separator", () => {
    expect(reviewSummary(counts({ not_in_durtal: 23, likely: 2, partially_held: 5 })))
      .toBe("25 to review · 23 not in Durtal · 5 linked to books you don’t own yet");
    expect(reviewSummary(counts({ automatic: 4 }))).toBe("4 linked automatically");
    expect(reviewSummary(counts({}))).toBeUndefined();
  });
});
