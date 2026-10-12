import { describe, expect, it } from "vitest";
import { reviewEffectIssues } from "@/lib/ebooks/review/preparation-errors";
import { ReviewPreparationError } from "@/lib/ebooks/review/errors";
import { ebookId } from "./fixtures";
describe("sanitized actual core effect issue projection", () => {
  it("maps missing author/language/file/location and ISBN/edition/copy/metadata decisions to explicit fields", () => {
    const issues = reviewEffectIssues(ebookId, { ready: false,
      missing: ["author", "language", "verified_file", "ebook_location"],
      ambiguities: [{ code: "multiple_isbns" }, { code: "multiple_editions" }, { code: "copy_taken" }, { code: "number_signature" }] });
    expect(issues.map((issue) => issue.field)).toEqual(["authors", "language", "file", "locationId", "isbn13", "edition", "copy", "metadata"]);
    expect(issues.every((issue) => issue.ebookId === ebookId)).toBe(true);
  });
  it("never propagates unknown codes, prototype fields or arbitrary effect text/source keys", () => {
    const privateText = "Failed SQL: s3_key=/private/source";
    const effect = { ready: false, missing: [privateText, "constructor"], ambiguities: [{ code: "__proto__", text: privateText }], text: privateText };
    const error = new ReviewPreparationError(reviewEffectIssues(ebookId, effect));
    expect(error.code).toBe("preparation_required");
    expect(error.issues.every((issue) => issue.code === "choice_required" && issue.field === "choices")).toBe(true);
    expect(JSON.stringify(error.issues)).not.toContain("private");
    expect(Object.isFrozen(error.issues)).toBe(true); expect(Object.isFrozen(error.issues[0])).toBe(true);
    expect(reviewEffectIssues(ebookId, { ...effect, ready: true })).toEqual([]);
  });
});
