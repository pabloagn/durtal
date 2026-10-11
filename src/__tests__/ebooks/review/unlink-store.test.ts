import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { prepareReviewUnlinkAtomicWrite, reviewUnlinkEffectHash } from "@/lib/ebooks/review/store";
import { reviewRequestHash, reviewPayloadHash } from "@/lib/ebooks/review/receipts";
import type { MatchCandidate } from "@/lib/ebooks/match/types";
import { REVIEW_RESULT_MARKER } from "@/lib/ebooks/review/store-sql";
import { unlinkFixture } from "./unlink-fixture";

describe("actual unlink decision store construction (no database)", () => {
  it("issues the actual decision capability and keeps capture before final full-state assertions", () => {
    const input = unlinkFixture(), prepared = prepareReviewUnlinkAtomicWrite(input);
    const db = { execute: (query: SQL) => query } as unknown as Db, dialect = new PgDialect();
    const queries = prepared.extension.after(db).map((q) => dialect.sqlToQuery(q as SQL));
    expect(queries[0].sql).toContain("insert into activity_events");
    expect(queries[1].sql).toContain("match_method is null");
    expect(queries[1].sql).toContain("link_written is null");
    expect(queries[1].sql).toContain("match_model_version");
    expect(queries[1].sql).toContain("::text[]");
    expect(queries[1].params).toContain(input.before.rawEbookSnapshotText);
    expect(queries.at(-1)!.params).toContain(REVIEW_RESULT_MARKER);
    expect(queries.slice(1).every((q) => !q.sql.includes("insert into"))).toBe(true);
    expect(input.seed.originalOperation).toBeNull();
    expect(input.request.originalOperation.operationId).not.toBe(input.seed.operation.operationId);
  });
  it("refuses compensation, a different native identity, stale raw metadata, changed effects and kept-copy outcome", () => {
    const base = unlinkFixture();
    expect(() => prepareReviewUnlinkAtomicWrite({ ...base, seed: { ...base.seed, originalOperation: base.request.originalOperation } })).toThrow();
    expect(() => prepareReviewUnlinkAtomicWrite({ ...base, request: { ...base.request,
      originalOperation: base.request.operation } })).toThrow();
    expect(() => prepareReviewUnlinkAtomicWrite({ ...base, before: { ...base.before,
      rawEbookSnapshotText: base.before.rawEbookSnapshotText + " " } })).toThrow();
    expect(() => prepareReviewUnlinkAtomicWrite({ ...base, request: { ...base.request, effectHash: "f".repeat(64) } })).toThrow();
    expect(() => prepareReviewUnlinkAtomicWrite({ ...base, seed: { ...base.seed,
      outcome: { ...base.seed.outcome, keptCopy: false } } })).toThrow();
    expect(() => prepareReviewUnlinkAtomicWrite({ ...base, frozenEnvelopeHash: "f".repeat(64) }))
      .toThrow("complete frozen preview");
  });
  it("guards the complete displayed classification candidates with native real precision", () => {
    const input = unlinkFixture(), candidate = { rank: 1, workId: input.request.ebookId,
      probability: 0.333333333333, weightBits: 1.123456789, marginBits: null, flags: [], reasons: [],
      effect: { editionId: null, instanceId: null, rule: "new_edition", ambiguities: [], movedFromEditionId: null } } as unknown as MatchCandidate;
    const plan = { ...input.plan, classification: { ...input.plan.classification, candidates: [candidate] } };
    const request = { ...input.request, effectHash: reviewUnlinkEffectHash(plan) };
    const prepared = prepareReviewUnlinkAtomicWrite({ ...input, plan, request,
      frozenEnvelopeHash: reviewPayloadHash({ plan, before: input.before, request }),
      seed: { ...input.seed, effectHash: request.effectHash, requestHash: reviewRequestHash(request) } });
    const db = { execute: (query: SQL) => query } as unknown as Db;
    const final = new PgDialect().sqlToQuery(prepared.extension.after(db)[1] as SQL);
    expect(final.sql).toContain("c.probability="); expect(final.sql).toContain("::real");
    expect(final.sql).toContain("c.reasons="); expect(final.sql).toContain("c.flags=");
    expect(final.sql).toContain("c.created_at="); expect(final.params).toContain(0.333333333333);
  });
  it("decodes only the declared terminal complete original-null receipt", () => {
    const input = unlinkFixture(), prepared = prepareReviewUnlinkAtomicWrite(input);
    const receipt = { ...input.seed, after: { ...input.before.snapshot,
      matchState: "pending", matchFingerprint: input.plan.classification.fingerprint,
      instanceId: null, updatedAt: "2026-10-10T10:00:01.000001Z" } };
    const row = { id: receipt.operation.operationId, entityType: "ebook", entityId: receipt.entityId,
      eventKey: receipt.eventKey, metadata: { extra: { ebookReview: receipt } }, __reviewResult: REVIEW_RESULT_MARKER };
    expect(prepared.readCommitted([{ rows: [row] }])[0]).toEqual(receipt);
    expect(() => prepared.readCommitted([{ rows: [row] }, []])).toThrow();
    expect(() => prepared.readCommitted([{ rows: [row, row] }])).toThrow();
    expect(() => prepared.readCommitted([{ rows: [{ ...row, metadata: { extra: { ebookReview: {
      ...receipt, originalOperation: input.request.originalOperation } } } }] }])).toThrow();
  });
});
