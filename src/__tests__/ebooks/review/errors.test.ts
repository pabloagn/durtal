import { describe, expect, it } from "vitest";
import { REVIEW_SQL_ERRORS, reviewWriteError } from "@/lib/ebooks/review/errors";
describe("review writer error boundary", () => {
  it("recognizes actual assertions through ORM/database wrappers without exposing SQL", () => {
    const database = new Error(REVIEW_SQL_ERRORS.invalid);
    const orm = new Error("Failed query: private key and SQL parameters", { cause: database });
    const result = reviewWriteError(new Error("wrapper", { cause: orm }));
    expect(result.code).toBe("invalid_receipt");
    expect(result.message).not.toContain("private");
    expect(reviewWriteError(new Error("Failed query", { cause:
      new Error("Matching snapshot changed in ebooks; make a new plan") })).code).toBe("stale_review");
  });
  it("keeps ambiguous transport outcomes retryable under the original identity", () => {
    const result = reviewWriteError(new Error("transport closed with private information"));
    expect(result.code).toBe("outcome_unknown_retry_original");
    expect(result.message).toContain("original operation");
    expect(result.message).not.toContain("private");
  });
});
