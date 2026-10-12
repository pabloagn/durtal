import { describe, expect, it } from "vitest";
import { reviewCopyMetadata } from "@/lib/ebooks/review-queue/copy-draft";

describe("atomic new-copy review metadata", () => {
  it("preserves descriptive/acquisition fields and delegates identity, digital values and status to the planner", () => {
    expect(reviewCopyMetadata({ editionId: "edition", locationId: "digital", format: "ebook", fileSizeBytes: 100,
      status: "available", notes: "A personal copy", condition: "mint", acquisitionSource: "Gift",
      acquisitionPrice: "12.50", subLocationId: null })).toEqual({ notes: "A personal copy", condition: "mint",
      acquisitionSource: "Gift", acquisitionPrice: "12.50", subLocationId: null });
  });
});
