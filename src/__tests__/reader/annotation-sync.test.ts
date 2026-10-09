import { describe, expect, it } from "vitest";
import {
  pendingAnnotation,
  undoPendingAnnotation,
  claimPendingAnnotation,
  releaseAnnotationClaim,
  acknowledgeAnnotationClaim,
  planAnnotationRequests,
} from "@/lib/reader/sync/annotation-outbox";
import { reconcileAnnotationPull } from "@/lib/reader/sync/annotations";
import { annotationBodySchema } from "@/lib/validations/annotations";
import { annotation, at, id, later, locator, put } from "./fixtures/annotation";
const queued = (mutation = put(), revision = 1) =>
  pendingAnnotation({
    ebookId: id(2),
    operationId: `op-${revision}`,
    revision,
    baseVersion: null,
    mutation,
    now: 0,
  });
const deletion = () =>
  pendingAnnotation({
    ebookId: id(2),
    operationId: "delete",
    revision: 1,
    baseVersion: at,
    mutation: { op: "delete", id: id(1), clientUpdatedAt: at },
    now: 0,
    snapshot: annotation(),
  });
const claim = (row = queued(), token = "tab-a") =>
  claimPendingAnnotation(row, { now: 1, token, hidden: true })!;

describe("annotation outbox transaction policies (no IDB adapter yet)", () => {
  it("keeps queued and sealed state through a serialized reload", () => {
    expect(JSON.parse(JSON.stringify(queued()))).toEqual(queued());
    const row = claim(deletion());
    expect(
      undoPendingAnnotation(JSON.parse(JSON.stringify(row)), 2).undone,
    ).toBe(false);
  });
  it("Undo wins only before expiry or a transmission claim", () => {
    expect(undoPendingAnnotation(deletion(), 9999)).toMatchObject({
      undone: true,
      snapshot: annotation(),
    });
    expect(
      claimPendingAnnotation(deletion(), {
        now: 9999,
        token: "a",
        hidden: false,
      }),
    ).toBeNull();
    expect(undoPendingAnnotation(deletion(), 10_000)).toMatchObject({
      undone: false,
      row: { stage: "sealed" },
    });
  });
  it("serializes both possible Undo-versus-flush orders", () => {
    // Transaction ordering A: Undo removes the row, leaving nothing to claim.
    const undoFirst = undoPendingAnnotation(deletion(), 100);
    expect(undoFirst.undone).toBe(true);
    // Transaction ordering B: hiding claims/seals the persisted row first.
    const flushFirst = claimPendingAnnotation(deletion(), {
      now: 100,
      token: "a",
      hidden: true,
    })!;
    expect(undoPendingAnnotation(flushFirst, 101).undone).toBe(false);
    expect(
      claimPendingAnnotation(flushFirst, {
        now: 101,
        token: "b",
        hidden: true,
      }),
    ).toBeNull();
  });
  it("returning before ten seconds or failed transmission never re-enables Undo", () => {
    const sealed = releaseAnnotationClaim(claim(deletion()), "tab-a");
    expect(sealed.stage).toBe("sealed");
    expect(undoPendingAnnotation(sealed, 5).undone).toBe(false);
    expect(
      claimPendingAnnotation(sealed, { now: 6, token: "tab-b", hidden: false })
        ?.stage,
    ).toBe("claimed");
  });
  it("an expired claim can be retried but an old acknowledgment cannot remove it", () => {
    const first = claim(deletion());
    const next = claimPendingAnnotation(first, {
      now: 30_001,
      token: "tab-b",
      hidden: false,
    })!;
    expect(
      acknowledgeAnnotationClaim(next, {
        operationId: next.operationId,
        revision: 1,
        token: "tab-a",
      }),
    ).toBe(next);
    expect(
      acknowledgeAnnotationClaim(next, {
        operationId: next.operationId,
        revision: 1,
        token: "tab-b",
      }),
    ).toBeNull();
    expect(undoPendingAnnotation(next, 30_002).undone).toBe(false);
  });
  it("an in-flight acknowledgment cannot drop a new revision", () => {
    const old = claim(),
      next = {
        ...queued(put({ note: "New edit" }), 2),
        operationId: old.operationId,
      };
    expect(
      acknowledgeAnnotationClaim(next, {
        operationId: old.operationId,
        revision: old.revision,
        token: "tab-a",
      }),
    ).toBe(next);
  });
  it("defers a valid oversized Unicode mutation whole and sends it intact in foreground", () => {
    const text = "🙂".repeat(10_000),
      note = "𐐀".repeat(10_000);
    const row = claim(
      queued(
        put({ text, note, locator: { ...locator, text: { highlight: text } } }),
      ),
    );
    const lifecycle = planAnnotationRequests(id(2), [row], "lifecycle");
    expect(lifecycle.requests).toHaveLength(0);
    expect(lifecycle.deferred).toEqual([row]);
    const reloaded = JSON.parse(
      JSON.stringify(releaseAnnotationClaim(row, "tab-a")),
    );
    const foreground = planAnnotationRequests(
      id(2),
      [claim(reloaded)],
      "foreground",
    ).requests[0];
    expect(foreground.bytes).toBeGreaterThan(64 * 1024);
    expect(foreground.body.upserts[0]).toMatchObject({ text, note });
    expect(
      annotationBodySchema(Date.parse(at)).safeParse(foreground.body).success,
    ).toBe(true);
  });
  it("sizes actual escaped UTF-8 JSON and batches whole items below the lifecycle budget", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      claim(queued(put({ id: id(i + 10), note: "\n".repeat(10_000) }), i + 1)),
    );
    const { requests, deferred } = planAnnotationRequests(
      id(2),
      rows,
      "lifecycle",
      50_000,
    );
    expect(requests.length).toBeGreaterThan(1);
    expect(deferred).toEqual([]);
    expect(requests.flatMap((r) => r.body.upserts)).toHaveLength(5);
    for (const request of requests) {
      expect(request.bytes).toBe(new TextEncoder().encode(request.json).length);
      expect(request.bytes).toBeLessThanOrEqual(50_000);
    }
  });
  it("waits for the oldest operation per annotation and uses the shared transport 100-item cap (endpoint still accepts 200)", () => {
    const first = claim(queued(put(), 1)),
      next = claim(queued(put({ note: "Next" }), 2));
    expect(
      planAnnotationRequests(id(2), [next, first], "foreground"),
    ).toMatchObject({
      requests: [{ operations: [{ operationId: "op-1" }] }],
      deferred: [next],
    });
    const rows = Array.from({ length: 201 }, (_, i) =>
      claim(queued(put({ id: id(i + 10) }), i + 1)),
    );
    expect(
      planAnnotationRequests(id(2), rows, "foreground").requests.map(
        (r) => r.operations.length,
      ),
    ).toEqual([100, 100, 1]);
  });
});

describe("pure pull reconciliation", () => {
  const response = (annotations = [annotation()], reset = false) => ({
    annotations,
    serverTime: later,
    reset,
  });
  it("overlays a pending note without changing confirmed rows or losing cursor precision", () => {
    const row = pendingAnnotation({
      ebookId: id(2),
      operationId: "note",
      revision: 2,
      baseVersion: at,
      now: 0,
      mutation: {
        op: "note",
        id: id(1),
        note: "Offline draft",
        clientUpdatedAt: later,
      },
    });
    const result = reconcileAnnotationPull({
      ebookId: id(2),
      cached: [],
      cursor: at,
      pending: [row],
      response: { ...response(), serverTime: "2026-10-09T12:00:01.000001Z" },
    });
    expect(result.cached[0].note).toBe("My thought");
    expect(result.display[0].note).toBe("Offline draft");
    expect(result.cursor).toBe("2026-10-09T12:00:01.000001Z");
  });
  it("a remote tombstone suppresses pending edits without discarding their draft", () => {
    const row = queued(
      put({ clientUpdatedAt: later, note: "Keep this draft" }),
    );
    const result = reconcileAnnotationPull({
      ebookId: id(2),
      cached: [annotation()],
      cursor: at,
      pending: [row],
      response: response([annotation({ deletedAt: later, updatedAt: later })]),
    });
    expect(result.display).toEqual([]);
    expect(result.conflicts).toEqual([
      { operationId: row.operationId, reason: "deleted" },
    ]);
    expect(row.mutation).toMatchObject({ note: "Keep this draft" });
  });
  it("a full reset drops absent known marks but retains new offline creates", () => {
    const known = {
      ...queued(put({ clientUpdatedAt: later })),
      baseVersion: at,
    };
    const result = reconcileAnnotationPull({
      ebookId: id(2),
      cached: [annotation()],
      cursor: at,
      pending: [known, queued(put({ id: id(8) }), 2)],
      response: response([], true),
    });
    expect(result.cached).toEqual([]);
    expect(result.display.map((row) => row.id)).toEqual([id(8)]);
    expect(result.conflicts).toEqual([
      { operationId: known.operationId, reason: "deleted" },
    ]);
  });
  it("a pending delete never allows a later queued put to reappear locally", () => {
    const result = reconcileAnnotationPull({
      ebookId: id(2),
      cached: [annotation()],
      cursor: at,
      pending: [deletion(), queued(put({ clientUpdatedAt: later }), 2)],
      response: response(),
    });
    expect(result.display).toEqual([]);
    expect(result.conflicts).toEqual([
      { operationId: "op-2", reason: "deleted" },
    ]);
  });
  it("refuses stale cursors, cross-book rows and rows beyond the response cursor", () => {
    const input = {
      ebookId: id(2),
      cached: [],
      cursor: later,
      pending: [],
      response: { annotations: [], serverTime: at, reset: false },
    };
    expect(() => reconcileAnnotationPull(input)).toThrow("backwards");
    expect(() =>
      reconcileAnnotationPull({
        ...input,
        cursor: null,
        response: response([annotation({ ebookId: id(9) })]),
      }),
    ).toThrow("another e-book");
    expect(() =>
      reconcileAnnotationPull({
        ...input,
        cursor: null,
        response: {
          ...response([annotation({ updatedAt: later })]),
          serverTime: at,
        },
      }),
    ).toThrow();
  });
});
