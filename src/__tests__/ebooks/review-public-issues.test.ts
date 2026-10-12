import { describe, expect, it } from "vitest";
import { ReviewPreparationError, type ReviewPreparationIssue } from "@/lib/ebooks/review/errors";
import { reviewUiResult } from "@/lib/ebooks/review-queue/result";
import { publicPreparationIssues } from "@/lib/ebooks/review-queue/preparation-issues";
import { ebookId } from "./review-ui-fixtures";
describe("Next preparation issue allowlist", () => {
  it("replaces even known issue messages/fields and strips extra properties and causes", async () => {
    const issue = { ebookId, field: "choices" as const, code: "author_identity", message: "SELECT private FROM secret",
      plan: { storageKey: "gold/private" }, previewToken: "private" };
    const result = await reviewUiResult(async () => { throw new ReviewPreparationError([issue], { cause: new Error("postgres://secret") }); });
    expect(result).toEqual({ ok: false, error: { code: "preparation_required", retryOriginal: false,
      message: "Complete the highlighted choices before preparing this review.",
      issues: [{ ebookId, field: "authors", code: "author_identity", message: "Choose the intended catalogue author." }] } });
    expect(JSON.stringify(result)).not.toMatch(/SELECT|storageKey|previewToken|postgres|secret/);
  });
  it("maps unknown/prototype codes to fixed choices, drops malformed identities and caps 250", () => {
    const unknown = { ebookId, field: "file", code: "__proto__", message: "/private/source.epub" } as ReviewPreparationIssue;
    expect(publicPreparationIssues([unknown])).toEqual([{ ebookId, field: "choices", code: "choice_required", message: "Review the edition and copy choices." }]);
    expect(publicPreparationIssues([{ ...unknown, ebookId: "private" }])).toEqual([]);
    expect(publicPreparationIssues(Array(251).fill(unknown))).toHaveLength(250);
  });
});
