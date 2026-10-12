import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { parseReviewUnlinkPolicy, prepareReviewUnlinkIntentSchema,
  reviewUnlinkGuardQueries, reviewUnlinkForwardUpdatedAt } from "@/lib/ebooks/review/unlink-contract";
import { reviewPayloadHash } from "@/lib/ebooks/review/receipts";
import { ebookId, operation } from "./fixtures";
const copyId = "00000000-0000-4000-8000-000000000004";
function fixture() {
  const after = { id: ebookId, instance_id: copyId, match_state: "linked", match_tier: null,
    match_fingerprint: "b".repeat(64), exclusion_reason: null, match_method: "score", title: "Original title",
    created_at: "2026-10-10T10:00:00.123455Z", updated_at: "2026-10-10T10:00:00.123456Z", matched_at: "2026-10-10T10:00:00+00:00" };
  // Parser fixture only. Not a committed native receipt or executable core plan.
  const receipt = { ...operation, kind: "link", ebookId, instanceId: copyId, after: { ebook: after } };
  return { version: 1 as const, purpose: "unlink_decision" as const, mode: "automatic_undo" as const,
    ebookId, originalMatchingOperation: operation, matchingAfterEbookText: JSON.stringify(after),
    rawEbookSnapshotText: JSON.stringify({ ...after, link_written: receipt }),
    expectedCurrent: { matchState: "linked" as const, matchTier: null, matchFingerprint: after.match_fingerprint,
      updatedAt: after.updated_at, instanceId: copyId, exclusionReason: null, candidatesHash: reviewPayloadHash([]) } };
}
describe("source-only reviewed unlink core contract", () => {
  it("binds an automatic matching identity and exact current/normalized after state without a review original", () => {
    const input = fixture(), policy = parseReviewUnlinkPolicy(input);
    expect(policy.originalMatchingOperation).toEqual(operation);
    expect(Object.isFrozen(policy)).toBe(true); expect(Object.isFrozen(policy.expectedCurrent)).toBe(true);
    expect(policy).not.toHaveProperty("originalReviewReceipt");
  });
  it("refuses later eBook edits for automatic Undo but binds the current row for a fresh unlink", () => {
    const input = fixture(), raw = JSON.parse(input.rawEbookSnapshotText);
    raw.title = "Human edit"; input.rawEbookSnapshotText = JSON.stringify(raw);
    expect(() => parseReviewUnlinkPolicy(input)).toThrow("later eBook change");
    expect(parseReviewUnlinkPolicy({ ...input, mode: "unlink" }).rawEbookSnapshotText).toContain("Human edit");
  });
  it("rejects replaced matching identities, missing commit evidence and client-supplied policy fields", () => {
    const input = fixture();
    expect(() => parseReviewUnlinkPolicy({ ...input, originalMatchingOperation: { ...operation, operationId: copyId } })).toThrow();
    const raw = JSON.parse(input.rawEbookSnapshotText); delete raw.link_written.after;
    expect(() => parseReviewUnlinkPolicy({ ...input, rawEbookSnapshotText: JSON.stringify(raw) })).toThrow();
    expect(() => prepareReviewUnlinkIntentSchema.parse({ ebookId, mode: "unlink", rawEbookSnapshotText: "injected" })).toThrow();
  });
  it("constructs actual raw/receipt/time guards and a forward update expression without issuing any mutation", () => {
    const dialect = new PgDialect(), db = { execute: (q: SQL) => q } as unknown as Db, input = fixture();
    const guards = reviewUnlinkGuardQueries(db, input).map((q) => dialect.sqlToQuery(q as SQL));
    expect(guards).toHaveLength(1); expect(guards[0].sql).toContain('harmonization_assert');
    expect(guards[0].sql).toContain('after,ebook'); expect(guards[0].sql).toContain('isfinite');
    expect(guards[0].params).toContain(input.rawEbookSnapshotText); expect(guards[0].params).toContain(input.matchingAfterEbookText);
    expect(guards[0].sql).not.toMatch(/update ebooks|insert into|delete from/);
    expect(dialect.sqlToQuery(reviewUnlinkForwardUpdatedAt(input)).sql).toContain("greatest(clock_timestamp(),updated_at+interval '1 microsecond')");
  });
});
