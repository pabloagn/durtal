import { describe, expect, it } from "vitest";
import { selectableReviewRows } from "@/components/ebooks/review-selection-bar";
import { reviewRow } from "../ebooks/review-ui-fixtures";

describe("review selection eligibility", () => {
  it("selects only pending rows with lossless guards", () => {
    const eligible = reviewRow();
    expect(selectableReviewRows([eligible, { ...reviewRow(), id: "invalid", stamp: null },
      { ...reviewRow(), id: "linked", state: "linked" }, { ...reviewRow(), id: "excluded", state: "excluded" }])).toEqual([eligible]);
  });
});
