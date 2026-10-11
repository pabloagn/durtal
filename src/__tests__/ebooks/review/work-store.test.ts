import { describe, expect, it, vi } from "vitest";
import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Db } from "@/lib/catalogue/work-store";
import { readWorkReviewBeforeOn, writeWorkReviewOn, replayWorkReviewOn,
  type WorkBeforeRead, type WorkReceipt, type WorkRequest, type WorkSeed } from "@/lib/ebooks/review/work-store";
import { reviewRequestHash, REVIEW_RECEIPT_EVENTS } from "@/lib/ebooks/review/receipts";
import { ebookId, operation } from "./fixtures";
const historyId = "00000000-0000-4000-8000-000000000004";
const dialect = new PgDialect();
function fixture() {
  const before: WorkBeforeRead = { workId: ebookId, rawWorkText: '{"id":"'+ebookId+'"}', historyTexts: [],
    activeLinkedCopy: true, stamp: { updatedAt: "2026-10-10T10:00:00.123456Z", catalogueStatus: "tracked",
      historyFingerprint: "a".repeat(64), dependencyFingerprint: "b".repeat(64), latestHistoryId: null } };
  const request: WorkRequest = { action: "mark_accessioned", workId: ebookId, operation,
    stamp: before.stamp, effectHash: "c".repeat(64) };
  const seed: WorkSeed = { version: 1, operation, entityType: "work", entityId: ebookId,
    eventKey: REVIEW_RECEIPT_EVENTS.workDecision, action: "mark_accessioned", originalOperation: null,
    requestHash: reviewRequestHash(request), effectHash: request.effectHash, before: before.stamp,
    outcome: { message: "Marks the book accessioned.", keptCopy: false } };
  const receipt: WorkReceipt = { ...seed, after: { ...before.stamp, catalogueStatus: "accessioned",
    updatedAt: "2026-10-10T10:00:00.123457Z", historyFingerprint: "d".repeat(64), latestHistoryId: historyId } };
  const row = { id: operation.operationId, entityType: "work" as const, entityId: ebookId,
    eventKey: REVIEW_RECEIPT_EVENTS.workDecision, metadata: { extra: { ebookReview: receipt, workReviewAfterRaw: "full DB after row" } },
    __workReviewResult: "durtal.work.review.row.v1" };
  return { before, request, seed, receipt, row };
}
/** SQL construction/decoder checks only; real database atomicity is covered by
 * the separately guarded local integration fixture, not these fake results. */
describe("guarded catalogue status writer", () => {
  it("schedules one status/history/receipt atomic with dependency guards and final assertions before the result", async () => {
    const input = fixture(), queries: SQL[] = [];
    const execute = vi.fn((query: SQL) => { queries.push(query); return query; });
    const db = { execute, batch: vi.fn(async (built: SQL[]) => built.map((_, index) =>
      index === built.length - 1 ? { rows: [input.row] } : { rows: [] })) } as unknown as Db;
    expect(await writeWorkReviewOn(db, { ...input, historyId })).toEqual(input.receipt);
    const statements = queries.map((query) => dialect.sqlToQuery(query));
    const text = statements.map((query) => query.sql).join("\n");
    expect(text).toContain('lock table'); expect(text).toContain('order_status_history');
    expect(text).toContain('ebook_files'); expect(text).toContain('instance_status_history');
    expect(text).toContain('sha256(convert_to'); expect(text).toContain('greatest(clock_timestamp()');
    const update = statements.findIndex((query) => query.sql.startsWith('update works'));
    const history = statements.findIndex((query) => query.sql.startsWith('insert into work_status_history'));
    const audit = statements.findIndex((query) => query.sql.startsWith('insert into activity_events'));
    expect(update).toBeLessThan(history); expect(history).toBeLessThan(audit);
    expect(statements.at(-2)!.params).toContain('EBOOK_REVIEW_INVALID_RECEIPT_V1');
    expect(statements.at(-1)!.params).toContain('durtal.work.review.row.v1');
    expect(text).not.toMatch(/update instances|update orders|update ebooks|delete from/);
  });
  it("refuses missing holdings, changed request binding or invalid receipt namespace before scheduling a write", async () => {
    const input = fixture(), batch = vi.fn(), db = { batch } as unknown as Db;
    await expect(writeWorkReviewOn(db, { ...input, historyId, before: { ...input.before, activeLinkedCopy: false } }))
      .rejects.toMatchObject({ code: "ineligible_state" });
    await expect(writeWorkReviewOn(db, { ...input, historyId, request: { ...input.request, effectHash: "e".repeat(64) } }))
      .rejects.toMatchObject({ code: "invalid_receipt" });
    await expect(writeWorkReviewOn(db, { ...input, historyId, seed: { ...input.seed, eventKey: REVIEW_RECEIPT_EVENTS.workUndo } }))
      .rejects.toMatchObject({ code: "invalid_receipt" });
    expect(batch).not.toHaveBeenCalled();
  });
  it("rejects invalid calendar snapshot evidence and consumes only a marked final authoritative receipt", async () => {
    const input = fixture();
    const readDb = { execute: vi.fn(async () => ({ rows: [{ ...input.before, valid: false }] })) } as unknown as Db;
    await expect(readWorkReviewBeforeOn(readDb, ebookId)).rejects.toMatchObject({ code: "stale_review" });
    const writeDb = { execute: (query: SQL) => query, batch: async () => [{ rows: [input.row] }, { rows: [] }] } as unknown as Db;
    await expect(writeWorkReviewOn(writeDb, { ...input, historyId })).rejects.toMatchObject({ code: "invalid_receipt" });
  });
  it("replays only guarded audit evidence without reading a deleted target", async () => {
    const input = fixture(), queries: SQL[] = [];
    const db = { execute: (q: SQL) => { queries.push(q); return q; }, batch: async (built: SQL[]) =>
      built.map((_, index) => index === built.length - 1 ? { rows: [input.row] } : { rows: [] }) } as unknown as Db;
    const stored = { row: input.row, receipt: input.receipt, rawSnapshotText: "full raw DB audit row", rawWorkAfterText: "full DB after row" };
    expect(await replayWorkReviewOn(db, stored, input.request)).toEqual(input.receipt);
    const text = queries.map((q) => dialect.sqlToQuery(q).sql).join("\n");
    expect(text).toContain('activity_events'); expect(text).not.toContain('from works');
    expect(text).not.toMatch(/insert into|update works|work_status_history/);
  });
});
