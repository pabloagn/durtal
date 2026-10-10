import { describe, expect, it } from "vitest";
import {
  canonicalReviewJson,
  readReviewReceiptRecord,
  reviewPayloadHash,
  reviewReceiptSchema,
  reviewRequestHash,
  reviewUndoOperationId,
  verifyReviewRetry as verifyStoredRetry,
  verifyReviewUndoRetry as verifyStoredUndoRetry,
  REVIEW_RECEIPT_EVENTS,
} from "@/lib/ebooks/review/receipts";
import {
  hash,
  id,
  keepReceipt,
  keepRequest,
  later,
  operation,
  undoReceipt,
  workStamp,
} from "./review-fixtures";

function storedRow(input: unknown) {
  const receipt = reviewReceiptSchema.parse(input);
  return {
    id: receipt.operation.operationId,
    entityType: receipt.entityType,
    entityId: receipt.entityId,
    eventKey: receipt.eventKey,
    metadata: { extra: { ebookReview: receipt } },
  };
}
const verifyReviewRetry = (receipt: unknown, request: unknown) =>
  verifyStoredRetry(storedRow(receipt), request);
const verifyReviewUndoRetry = (receipt: unknown, original: unknown) =>
  verifyStoredUndoRetry(storedRow(receipt), storedRow(original));

describe("canonical request and receipt identities (no database commit proof)", () => {
  it("ignores object insertion order but preserves null, array order and microseconds", () => {
    expect(reviewPayloadHash({ b: 2, a: { z: 1, x: 0 } })).toBe(
      reviewPayloadHash({ a: { x: 0, z: 1 }, b: 2 }),
    );
    expect(reviewPayloadHash([1, 2])).not.toBe(reviewPayloadHash([2, 1]));
    expect(reviewPayloadHash({ x: null })).not.toBe(reviewPayloadHash({}));
    expect(reviewRequestHash(keepRequest())).not.toBe(
      reviewRequestHash({
        ...keepRequest(),
        stamp: { ...keepRequest().stamp, updatedAt: later },
      }),
    );
  });
  it.each([
    undefined,
    NaN,
    Infinity,
    -Infinity,
    new Date(),
    new Map(),
    BigInt(1),
    { x: undefined },
    Array(2),
  ])("refuses lossy non-JSON value %#", (input) => {
    expect(() => canonicalReviewJson(input)).toThrow();
  });
  it("refuses sparse arrays disguised with extra properties and symbol keys", () => {
    const array: unknown[] & { extra?: number } = Array(2);
    array[1] = 1;
    array.extra = 2;
    expect(() => canonicalReviewJson(array)).toThrow();
    expect(() => canonicalReviewJson({ [Symbol("hidden")]: 1 })).toThrow();
  });
  it("returns a verified committed decision for matching retries without needing current row state", () => {
    const receipt = keepReceipt();
    expect(verifyReviewRetry(receipt, keepRequest())).toEqual(receipt);
    expect(verifyReviewRetry(receipt, keepRequest())).toEqual(receipt);
  });
  it.each(["operationId", "runId", "planSha256", "targetDatabase"])(
    "rejects a reused operation with changed %s",
    (field) => {
      const value = field.endsWith("Id")
        ? id(999)
        : field === "planSha256"
          ? "b".repeat(64)
          : "another-database";
      expect(() =>
        verifyReviewRetry(keepReceipt(), {
          ...keepRequest(),
          operation: { ...operation, [field]: value },
        }),
      ).toThrow();
    },
  );
  it("rejects changed target, effect, action and expected stamp", () => {
    for (const request of [
      { ...keepRequest(), ebookId: id(999) },
      { ...keepRequest(), effectHash: "b".repeat(64) },
      { ...keepRequest(), action: "exclude", reason: "other" },
      { ...keepRequest(), stamp: { ...keepRequest().stamp, updatedAt: later } },
    ])
      expect(() => verifyReviewRetry(keepReceipt(), request)).toThrow();
  });
  it("requires receipt before-state to bind the original request", () => {
    const receipt = keepReceipt();
    expect(() =>
      verifyReviewRetry(
        {
          ...receipt,
          before: { ...receipt.before, matchFingerprint: "b".repeat(64) },
        },
        keepRequest(),
      ),
    ).toThrow();
  });
  it("fails closed on missing/corrupt receipts, wrong namespace and retained candidates", () => {
    const receipt = keepReceipt();
    for (const stored of [
      null,
      {},
      { ...receipt, eventKey: REVIEW_RECEIPT_EVENTS.ebookUndo },
      {
        ...receipt,
        after: { ...receipt.after, updatedAt: receipt.before.updatedAt },
      },
      { ...receipt, after: { ...receipt.after, candidatesHash: hash } },
      { ...receipt, after: { ...receipt.after, exclusionReason: "other" } },
      {
        ...receipt,
        after: { ...receipt.after, matchState: "linked", instanceId: null },
      },
      {
        ...receipt,
        before: {
          ...receipt.before,
          matchState: "linked",
          matchTier: null,
          instanceId: id(88),
          candidatesHash: reviewPayloadHash([]),
        },
      },
    ])
      expect(() => verifyReviewRetry(stored, keepRequest())).toThrow();
  });
  it("binds the actual activity row's unique key, target and namespace to its payload", () => {
    const receipt = keepReceipt();
    const row = {
      id: receipt.operation.operationId,
      entityType: receipt.entityType,
      entityId: receipt.entityId,
      eventKey: receipt.eventKey,
      metadata: { extra: { ebookReview: receipt } },
    };
    expect(readReviewReceiptRecord(row)).toEqual(receipt);
    for (const fields of [
      { id: id(999) },
      { entityId: id(999) },
      { entityType: "work" },
      { eventKey: REVIEW_RECEIPT_EVENTS.ebookUndo },
    ]) {
      expect(() => readReviewReceiptRecord({ ...row, ...fields })).toThrow();
      expect(() =>
        verifyStoredRetry({ ...row, ...fields }, keepRequest()),
      ).toThrow();
    }
  });
  it("generates one deterministic, valid UUID compensation key bound to all operation identity fields", () => {
    expect(reviewUndoOperationId(operation)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(reviewUndoOperationId({ ...operation })).toBe(
      reviewUndoOperationId(operation),
    );
    expect(
      reviewUndoOperationId({
        ...operation,
        targetDatabase: "another-database",
      }),
    ).not.toBe(reviewUndoOperationId(operation));
  });
  it("validates the same durable compensation after repeated or response-lost Undo", () => {
    expect(verifyReviewUndoRetry(undoReceipt(), keepReceipt())).toEqual(
      undoReceipt(),
    );
    expect(verifyReviewUndoRetry(undoReceipt(), keepReceipt())).toEqual(
      undoReceipt(),
    );
    expect(() => verifyReviewRetry(undoReceipt(), keepRequest())).toThrow();
  });
  it("rejects compensation for a different decision and malformed compensation identity", () => {
    expect(() =>
      verifyReviewUndoRetry(undoReceipt(), {
        ...keepReceipt(),
        operation: { ...operation, operationId: id(999) },
      }),
    ).toThrow();
    expect(() =>
      verifyReviewUndoRetry({ ...undoReceipt(), operation }, keepReceipt()),
    ).toThrow();
    expect(() =>
      verifyReviewUndoRetry(
        { ...undoReceipt(), requestHash: hash },
        keepReceipt(),
      ),
    ).toThrow();
    const compensation = undoReceipt();
    expect(() =>
      verifyReviewUndoRetry(
        {
          ...compensation,
          before: { ...compensation.before, matchFingerprint: "b".repeat(64) },
        },
        keepReceipt(),
      ),
    ).toThrow();
    expect(() =>
      verifyReviewUndoRetry(
        {
          ...compensation,
          after: {
            ...compensation.after,
            matchState: "standalone",
            matchTier: null,
            candidatesHash: reviewPayloadHash([]),
          },
        },
        keepReceipt(),
      ),
    ).toThrow();
  });
  it("requires a new status-history identity with unchanged acquisition dependencies", () => {
    const receipt = {
      ...keepReceipt(),
      entityType: "work",
      entityId: id(4),
      eventKey: REVIEW_RECEIPT_EVENTS.workDecision,
      action: "mark_accessioned",
      before: workStamp,
      after: {
        ...workStamp,
        updatedAt: later,
        catalogueStatus: "accessioned",
        latestHistoryId: id(11),
        historyFingerprint: "b".repeat(64),
      },
    };
    expect(reviewReceiptSchema.safeParse(receipt).success).toBe(true);
    const compensation = {
      ...receipt,
      action: "undo",
      eventKey: REVIEW_RECEIPT_EVENTS.workUndo,
      originalOperation: operation,
      operation: {
        ...operation,
        operationId: reviewUndoOperationId(operation),
      },
      requestHash: reviewPayloadHash({
        action: "undo",
        entityType: "work",
        entityId: id(4),
        originalOperation: operation,
      }),
      before: receipt.after,
      after: {
        ...workStamp,
        updatedAt: "2026-10-09T20:00:00.000003Z",
        latestHistoryId: id(12),
        historyFingerprint: "c".repeat(64),
      },
    };
    expect(verifyReviewUndoRetry(compensation, receipt)).toMatchObject({
      after: { catalogueStatus: "wanted" },
    });
    expect(() =>
      verifyReviewUndoRetry(
        {
          ...compensation,
          after: { ...compensation.after, catalogueStatus: "shortlisted" },
        },
        receipt,
      ),
    ).toThrow();
    for (const after of [
      { ...receipt.after, latestHistoryId: workStamp.latestHistoryId },
      { ...receipt.after, historyFingerprint: hash },
      { ...receipt.after, dependencyFingerprint: "c".repeat(64) },
    ]) {
      expect(reviewReceiptSchema.safeParse({ ...receipt, after }).success).toBe(
        false,
      );
    }
  });
});
