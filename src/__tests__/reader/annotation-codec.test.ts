import { describe, expect, it, vi } from "vitest";
import {
  encodeSharedAnnotation,
  sharedAnnotationTransport,
  decodeSharedAnnotationPending,
  encodeSharedAnnotationPending,
  decodeAnnotationReceipt,
} from "@/lib/reader/sync/annotation-codec";
import { serializeAnnotationOperation } from "@/lib/reader/sync/annotation-transport";
import { pendingAnnotation } from "@/lib/reader/sync/annotation-outbox";
import { planReplayClaim } from "@/lib/reader/offline/outbox-policy";
import type { StoredOperation } from "@/lib/reader/offline/store";
import { annotation, id, at, later, put } from "./fixtures/annotation";
const operation = (deleting = false, quote = false) =>
  serializeAnnotationOperation(
    pendingAnnotation({
      ebookId: id(2),
      operationId: "original-op",
      revision: 3,
      baseVersion: deleting ? at : null,
      mutation: deleting
        ? {
            op: "delete",
            id: id(1),
            clientUpdatedAt: at,
            quoteEffect: quote
              ? {
                  action: "keep-quote",
                  noteId: id(8),
                  expectedNoteVersion: "opaque μ",
                  expectedBindingVersion: "binding",
                }
              : { action: "none" },
          }
        : put(),
      now: 0,
      snapshot: deleting
        ? annotation(quote ? { style: "quote", color: null } : {})
        : null,
    }),
    { fileId: id(3), expectedDeviceId: id(4), createdAt: at },
  );
const stored = (deleting = false, quote = false): StoredOperation => ({
  ...encodeSharedAnnotation(operation(deleting, quote)),
  v: 1,
  seq: 1,
  attempts: 0,
  state: "waiting",
  claim: null,
  retryAt: null,
});
const plan = (row: StoredOperation) => {
  const result = planReplayClaim([row], {
    visible: true,
    reachable: true,
    currentDeviceId: id(4),
    nowMs: 20_000,
    token: "claim",
    mode: "foreground",
  });
  if (result.kind !== "claim") throw new Error("fixture claim");
  return result;
};
describe("annotation codec for the concrete common store", () => {
  it("preserves the exact operation/revision/device/file/body across decoding and re-encoding", () => {
    const row = stored();
    const owner = decodeSharedAnnotationPending(row);
    expect(encodeSharedAnnotationPending(owner).mutation).toEqual(row.mutation);
    expect(owner.transportIdentity).toEqual({
      fileId: id(3),
      expectedDeviceId: id(4),
      createdAt: at,
    });
  });
  it("does not invent a seal while durable Undo metadata remains open", () => {
    const row = stored(true);
    // A hidden preflight has not committed a seal. Only the shared owner may do it.
    row.annotation!.pending.stage = "sealed";
    expect(decodeSharedAnnotationPending(row).stage).toBe("undoable");
    expect(decodeSharedAnnotationPending(row).undoUntil).toBe(10_000);
  });
  it("takes claim and irreversible seal state from persisted shared metadata after a reload", () => {
    const row = stored(true);
    row.annotation!.undo!.state = "sealed";
    row.state = "claimed";
    row.claim = { token: "native-claim", expiresAt: 90_000 };
    const owner = decodeSharedAnnotationPending(
      JSON.parse(JSON.stringify(row)),
    );
    expect(owner.stage).toBe("claimed");
    expect(owner.claim).toEqual({ token: "native-claim", until: 90_000 });
    row.state = "waiting";
    row.claim = null;
    expect(decodeSharedAnnotationPending(row).stage).toBe("sealed");
    expect(encodeSharedAnnotationPending(owner).mutation).toEqual(row.mutation);
  });
  it("refuses mismatched owner identity or local logical body", () => {
    const row = stored();
    row.annotation!.pending.revision = 4;
    expect(() => decodeSharedAnnotationPending(row)).toThrow("identity");
    const changed = stored();
    (changed.annotation!.pending.mutation as Record<string, unknown>).note =
      "changed";
    expect(() => decodeSharedAnnotationPending(changed)).toThrow("payload");
  });
  it("requires complete item receipts and updates authoritative rows without advancing the pull cursor", () => {
    const claimed = plan(stored());
    expect(() =>
      decodeAnnotationReceipt(
        { applied: [], ignored: [], annotations: [], serverTime: later },
        claimed,
      ),
    ).toThrow("Incomplete");
    expect(() =>
      decodeAnnotationReceipt(
        { applied: [id(1)], ignored: [], annotations: [], serverTime: later },
        claimed,
      ),
    ).toThrow("authoritative");
    const decoded = decodeAnnotationReceipt(
      {
        applied: [id(1)],
        ignored: [],
        annotations: [annotation({ updatedAt: later })],
        serverTime: later,
      },
      claimed,
    );
    const updated = decoded.updateBook(id(2), {
      annotations: [],
      cursor: at,
      pending: [],
    });
    expect(updated.cursor).toBe(at);
    expect(updated.annotations).toEqual([annotation({ updatedAt: later })]);
  });
  it("retains a sealed composed quote delete for a version conflict and refuses a stale operation echo", () => {
    const claimed = plan(stored(true, true));
    const body = {
      applied: [],
      ignored: [{ id: id(1), reason: "note-version" }],
      annotations: [],
      serverTime: later,
      operations: [{ operationId: "original-op", revision: 3 }],
    };
    expect(() => decodeAnnotationReceipt(body, claimed)).toThrow(
      "Sealed quote delete conflict",
    );
    expect(() =>
      decodeAnnotationReceipt(
        { ...body, operations: [{ operationId: "original-op", revision: 2 }] },
        claimed,
      ),
    ).toThrow("exact composed");
  });
});

// Source contract tests: real codec over structural shared-store fixtures.
describe("annotation conflict transport boundary", () => {
  it("delivers retained rejected intent without enqueueing or restamping it", async () => {
    const row = stored(), before = JSON.stringify(row);
    const enqueue = vi.fn();
    const transport = { store: { readBook: async () => ({ annotations: [], cursor: null, pending: [] }), readRejected: async () => [{ v: 1, key: row.mutation.operationId, row, outcome: "ignored", reason: "deleted" }] }, enqueue } as unknown as import("@/lib/reader/offline/transport").ReaderTransport;
    const problems = await sharedAnnotationTransport(transport).readProblems(id(2));
    expect(problems[0].operation.transportIdentity?.expectedDeviceId).toBe(id(4));
    expect(problems[0].operation.revision).toBe(3); expect(problems[0].reason).toBe("deleted");
    expect(enqueue).not.toHaveBeenCalled(); expect(JSON.stringify(row)).toBe(before);
  });
  it("retries only an exact blocked original revision through shared auth reconciliation", async () => {
    const row = stored(); row.state = "blocked"; row.attempts = 2;
    const reconcile = vi.fn(async () => true);
    const transport = { store: { readBook: async () => ({ annotations: [], cursor: null, pending: [row] }) }, reconcile } as unknown as import("@/lib/reader/offline/transport").ReaderTransport;
    const boundary = sharedAnnotationTransport(transport);
    expect(await boundary.retryBlocked(id(2),row.mutation.operationId,4)).toBe(false);
    expect(reconcile).not.toHaveBeenCalled();
    expect(await boundary.retryBlocked(id(2),row.mutation.operationId,3)).toBe(true);
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ deviceId: id(4), fileId: id(3), revision: 3, attempts: 2 }));
  });
});
