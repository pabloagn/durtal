import { describe, expect, it, vi } from "vitest";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Db } from "@/lib/catalogue/work-store";
import {
  prepareReviewAtomicWrite, readReviewBeforeOn, supportedDecision,
  prepareReviewCompensationAtomicWrite,
  type ReviewBeforeRead,
} from "@/lib/ebooks/review/store";
import { candidateHashSql, REVIEW_RESULT_MARKER, REVIEW_UUID_PATTERN,
  reviewNullableUuidSql, reviewTimestampIsValidSql, reviewTimestampSql } from "@/lib/ebooks/review/store-sql";
import { z } from "zod/v4";
import { reviewPayloadHash, reviewRequestHash, reviewUndoOperationId, REVIEW_RECEIPT_EVENTS } from "@/lib/ebooks/review/receipts";
import { decisionFixture, ebookId, operation } from "./fixtures";

const dialect = new PgDialect();
function captured(prepared: ReturnType<typeof prepareReviewAtomicWrite>) {
  const execute = vi.fn((query: SQL) => query);
  const d = { execute } as unknown as Db;
  return [...prepared.extension.before(d), ...prepared.extension.after(d)]
    .map((query) => dialect.sqlToQuery(query as SQL));
}
describe("actual review store query construction", () => {
  it("issues a real synchronous core capability with exact guards, capture, final validation and terminal result", () => {
    const prepared = prepareReviewAtomicWrite(decisionFixture());
    const queries = captured(prepared), text = queries.map((query) => query.sql).join("\n");
    expect(prepared.extension.extraTables).toEqual(["activity_events"]);
    expect(text).toContain("not exists(select 1 from activity_events");
    expect(text).toContain("insert into activity_events");
    expect(text).toContain("isfinite(e.updated_at)");
    expect(text).toContain('e.updated_at >');
    expect(text).toContain('::timestamptz');
    expect(text).toContain("IS TRUE");
    expect(text).toContain("sha256(convert_to");
    expect(queries.at(-1)!.params).toContain(REVIEW_RESULT_MARKER);
    expect(queries.at(-1)!.sql).toContain('"__reviewResult"');
    expect(queries.at(-2)!.params).toContain("EBOOK_REVIEW_INVALID_RECEIPT_V1");
    expect(text).not.toMatch(/update ebooks|delete from|begin|commit/i);
  });
  it("copies the inputs before exposing builders; later caller mutation cannot change a guard or receipt", () => {
    const input = decisionFixture(), prepared = prepareReviewAtomicWrite(input);
    input.seeds[0].outcome.message = "Changed later";
    (input.beforeReads[0] as { rawEbookSnapshotText: string }).rawEbookSnapshotText = "Changed later";
    const params = JSON.stringify(captured(prepared).map((query) => query.params));
    expect(params).not.toContain("Changed later");
    expect(params).toContain("Kept.");
    expect(params).toContain("123456");
  });
  it("accepts only the declared final authoritative row set, not a prepared receipt or earlier result", () => {
    const input = decisionFixture(), prepared = prepareReviewAtomicWrite(input);
    const receipt = { ...input.seeds[0], after: { ...input.seeds[0].before,
      matchState: "standalone", updatedAt: "2026-10-10T10:00:00.123457Z" } };
    const row = { id: operation.operationId, entityType: "ebook", entityId: ebookId,
      eventKey: REVIEW_RECEIPT_EVENTS.ebookDecision, metadata: { extra: { ebookReview: receipt } },
      __reviewResult: REVIEW_RESULT_MARKER };
    expect(prepared.readCommitted([[], { rows: [row] }])[0].after.updatedAt).toBe("2026-10-10T10:00:00.123457Z");
    expect(() => prepared.readCommitted([{ rows: [row] }, []])).toThrow();
    expect(() => prepared.readCommitted([{ rows: [row, row] }])).toThrow();
    expect(() => prepared.readCommitted([{ rows: [{ ...row, __reviewResult: "wrong" }] }])).toThrow();
    const invalid = { ...row, metadata: { extra: { ebookReview: { ...receipt, after: receipt.before } } } };
    expect(() => prepared.readCommitted([{ rows: [invalid] }])).toThrow();
  });
  it("binds request/stamp/hash/state before issuing any capability", () => {
    const input = decisionFixture();
    input.requests[0].effectHash = "d".repeat(64);
    expect(() => prepareReviewAtomicWrite(input)).toThrow("exact decision request");
    const stale = decisionFixture();
    (stale.beforeReads[0] as { snapshot: ReviewBeforeRead["snapshot"] }).snapshot =
      { ...stale.beforeReads[0].snapshot, updatedAt: "2026-10-10T10:00:00.123455Z" };
    expect(() => prepareReviewAtomicWrite(stale)).toThrow("prepared operation");
    const duplicate = decisionFixture();
    expect(() => prepareReviewAtomicWrite({ ...duplicate, seeds: [...duplicate.seeds, duplicate.seeds[0]] })).toThrow();
  });
  it("rejects work operations and fresh unlink before a writer", () => {
    const base = decisionFixture().requests[0];
    expect(() => supportedDecision({ ...base, action: "unlink", originalOperation: operation })).toThrow("not supported");
    expect(() => supportedDecision({ action: "mark_accessioned", workId: ebookId, operation,
      effectHash: base.effectHash, stamp: { updatedAt: base.stamp.updatedAt, catalogueStatus: "tracked",
        historyFingerprint: "a".repeat(64), dependencyFingerprint: "b".repeat(64), latestHistoryId: null } })).toThrow("not supported");
  });
  it("checks the actual database candidate digest against JS full-string-array canonical hashing", async () => {
    const input = decisionFixture(), before = input.beforeReads[0];
    const texts = ['{"id":"one","probability":0.3333333,"reasons":["é\\n😀"]}'];
    const row = { ...before, candidateSnapshotTexts: texts,
      snapshot: { ...before.snapshot, candidatesHash: reviewPayloadHash(texts) }, snapshotValid: true };
    const d = { execute: vi.fn(async () => ({ rows: [row] })) } as unknown as Db;
    expect((await readReviewBeforeOn(d, ebookId))!.candidateSnapshotTexts).toEqual(texts);
    const bad = { ...row, snapshot: { ...row.snapshot, candidatesHash: "f".repeat(64) } };
    const badDb = { execute: vi.fn(async () => ({ rows: [bad] })) } as unknown as Db;
    await expect(readReviewBeforeOn(badDb, ebookId)).rejects.toThrow("hashing differs");
    const query = dialect.sqlToQuery(candidateHashSql(sql`${ebookId}::uuid`));
    expect(query.sql).toContain("order by c.rank,c.id");
    expect(query.sql).toContain("created_at");
    expect(query.sql).not.toContain("digest(");
  });
  it("validates every final batch receipt only after all inserts, including exact set/count", () => {
    const first = decisionFixture(), otherId = "00000000-0000-4000-8000-000000000004";
    const otherOp = { ...operation, operationId: "00000000-0000-4000-8000-000000000005" };
    const base = supportedDecision(first.requests[0]);
    const requests = [{ ...base, action: "accession" as const },
      { ...base, action: "accession" as const, ebookId: otherId, operation: otherOp }];
    const beforeReads = [first.beforeReads[0], { ...first.beforeReads[0], ebookId: otherId }];
    const seeds = [{ ...first.seeds[0], action: "accession" as const, requestHash: reviewRequestHash(requests[0]) },
      { ...first.seeds[0], action: "accession" as const, entityId: otherId, operation: otherOp,
      requestHash: reviewRequestHash(requests[1]) }];
    const prepared = prepareReviewAtomicWrite({ ...first, requests, beforeReads, seeds,
      binding: { ...first.binding, coreWriter: "accession", ebookIds: [ebookId, otherId],
        reviewOperations: [operation, otherOp] } });
    const d = { execute: (query: SQL) => query } as unknown as Db;
    const after = prepared.extension.after(d).map((query) => dialect.sqlToQuery(query as SQL));
    expect(after.slice(0, 2).every((q) => q.sql.includes("insert into activity_events"))).toBe(true);
    expect(after.slice(2, -1).every((q) => q.params.includes("EBOOK_REVIEW_INVALID_RECEIPT_V1"))).toBe(true);
    expect(after.slice(2).some((q) => q.sql.includes("insert into"))).toBe(false);
    expect(after.at(-2)!.sql).toContain("count(*)");
    expect(after.at(-2)!.params).toContain(2);
    expect(after.at(-1)!.params).toContain(REVIEW_RESULT_MARKER);
  });
  it("matches pinned strict UUID semantics for canonical PG text, including nil/max", () => {
    const pattern = new RegExp(REVIEW_UUID_PATTERN);
    const values = ["00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff",
      ...Array.from({ length: 8 }, (_, i) => `11111111-1111-${i + 1}111-8111-111111111111`),
      "11111111-1111-4111-a111-111111111111", "11111111-1111-4111-b111-111111111111",
      "11111111-1111-0111-8111-111111111111", "11111111-1111-9111-8111-111111111111",
      "11111111-1111-4111-0111-111111111111", "11111111-1111-4111-c111-111111111111"];
    for (const value of values) expect(pattern.test(value)).toBe(z.uuid().safeParse(value).success);
    expect(dialect.sqlToQuery(reviewNullableUuidSql(sql`e.instance_id`)).params).toContain(REVIEW_UUID_PATTERN);
  });
  it("bounds actual instants and refuses to serialize unsupported eras/years", async () => {
    const validity = dialect.sqlToQuery(reviewTimestampIsValidSql(sql`e.updated_at`)).sql;
    expect(validity).toContain("isfinite(e.updated_at)");
    expect(validity).toContain("0001-01-01T00:00:00Z");
    expect(validity).toContain("10000-01-01T00:00:00Z");
    const projection = dialect.sqlToQuery(reviewTimestampSql(sql`e.updated_at`)).sql;
    expect(projection).toContain("case when");
    expect(projection).toContain("else null end");
    const invalidDb = { execute: vi.fn(async () => ({ rows: [{ ...decisionFixture().beforeReads[0], snapshotValid: false }] })) } as unknown as Db;
    await expect(readReviewBeforeOn(invalidDb, ebookId)).rejects.toMatchObject({ code: "invalid_receipt" });
  });
  it("requires original committed after, deterministic identity and supported inverse for compensation", () => {
    const input = decisionFixture();
    const originalReceipt = { ...input.seeds[0], after: { ...input.seeds[0].before,
      matchState: "standalone" as const, updatedAt: "2026-10-10T10:00:00.123457Z" } };
    const original = { row: { id: operation.operationId, entityType: "ebook" as const,
      entityId: ebookId, eventKey: REVIEW_RECEIPT_EVENTS.ebookDecision,
      metadata: { extra: { ebookReview: originalReceipt } } },
      receipt: originalReceipt, rawSnapshotText: JSON.stringify({ id: operation.operationId,
        entity_type: "ebook", entity_id: ebookId, event_key: REVIEW_RECEIPT_EVENTS.ebookDecision,
        metadata: { extra: { ebookReview: originalReceipt } } }) };
    const compensationOperation = { ...operation, operationId: reviewUndoOperationId(operation) };
    const seed = { ...input.seeds[0], operation: compensationOperation, action: "undo" as const,
      eventKey: REVIEW_RECEIPT_EVENTS.ebookUndo, originalOperation: operation,
      before: originalReceipt.after,
      requestHash: reviewPayloadHash({ action: "undo", entityType: "ebook", entityId: ebookId, originalOperation: operation }) };
    const binding = { ...input.binding, coreWriter: "classification" as const,
      coreOperation: { ...operation, operationId: ebookId, planSha256: "e".repeat(64) },
      reviewOperations: [compensationOperation], purpose: "compensation" as const,
      compensation: { originalOperation: operation, compensationOperationId: compensationOperation.operationId,
        originalAfterUpdatedAt: originalReceipt.after.updatedAt } };
    const before = { ...input.beforeReads[0], snapshot: originalReceipt.after };
    const prepared = prepareReviewCompensationAtomicWrite({ binding, original, before, seed, frozenEnvelopeHash: "c".repeat(64) });
    expect(captured(prepared).map((q) => q.sql).join(" ")).toContain("original.metadata");
    expect(() => prepareReviewCompensationAtomicWrite({ binding, original, before,
      seed: { ...seed, operation: operation }, frozenEnvelopeHash: "c".repeat(64) })).toThrow();
  });
});
