import { describe, expect, it } from "vitest";
import {
  preparedAnnotationDelete,
  planComposedAnnotationDelete,
  planTrackerQuoteDelete,
  type DeferredQuoteEffect,
  type ReadingQuoteBinding,
} from "@/lib/reader/annotation-deletion";
import {
  pendingAnnotation,
  undoPendingAnnotation,
  claimPendingAnnotation,
  releaseAnnotationClaim,
  settleAnnotationDeleteClaim,
  planAnnotationRequests,
} from "@/lib/reader/sync/annotation-outbox";
import { serializeAnnotationOperation } from "@/lib/reader/sync/annotation-transport";
import { annotationBodySchema } from "@/lib/validations/annotations";
import { mergeAnnotation } from "@/lib/reader/sync/annotation-merge";
import { annotation, at, id, later, put } from "./fixtures/annotation";

const quote = () => annotation({ style: "quote", color: null });
const effect = (
  action: "keep-quote" | "delete-quote" = "delete-quote",
): Exclude<DeferredQuoteEffect, { action: "none" }> => ({
  action,
  noteId: id(9),
  expectedNoteVersion: "note:2026-10-09T12:00:00.000001+00:00",
  expectedBindingVersion: "binding: 0001 ",
});
const binding = (): ReadingQuoteBinding => ({
  noteId: id(9),
  annotationId: id(1),
  ebookId: id(2),
  noteVersion: effect().expectedNoteVersion,
  bindingVersion: effect().expectedBindingVersion,
});
const mutation = (choice = effect()) =>
  preparedAnnotationDelete({
    annotation: quote(),
    prepared: { status: "proceed", effect: choice },
    clientUpdatedAt: at,
  })!;
const pending = (choice = effect()) =>
  pendingAnnotation({
    ebookId: id(2),
    operationId: "composed-delete",
    revision: 7,
    baseVersion: at,
    mutation: mutation(choice),
    now: 0,
    snapshot: quote(),
  });
const claim = (row = pending(), token = "tab-a") =>
  claimPendingAnnotation(row, { now: 100, token, hidden: true })!;
const plan = (
  patch: Partial<Parameters<typeof planComposedAnnotationDelete>[0]> = {},
) =>
  planComposedAnnotationDelete({
    ebookId: id(2),
    authorized: true,
    current: quote(),
    retired: null,
    mutation: mutation(),
    binding: binding(),
    serverTime: later,
    ...patch,
  });

describe("deferred quote deletion policies (no tracker writer or IDB adapter)", () => {
  it("cancellation or an aborted confirmation creates no mutation or queue operation", () => {
    expect(
      preparedAnnotationDelete({
        annotation: quote(),
        prepared: { status: "cancel" },
        clientUpdatedAt: at,
      }),
    ).toBeNull();
    const controller = new AbortController();
    controller.abort();
    expect(
      preparedAnnotationDelete({
        annotation: quote(),
        prepared: { status: "proceed", effect: effect() },
        clientUpdatedAt: at,
        signal: controller.signal,
      }),
    ).toBeNull();
  });
  it("requires an explicit quote choice and cannot attach an effect to a plain mark", () => {
    expect(() =>
      pendingAnnotation({
        ...pending(),
        mutation: { op: "delete", id: id(1), clientUpdatedAt: at },
        now: 0,
      }),
    ).toThrow("explicit");
    expect(() =>
      preparedAnnotationDelete({
        annotation: annotation(),
        prepared: { status: "proceed", effect: effect() },
        clientUpdatedAt: at,
      }),
    ).toThrow("explicit");
    expect(
      plan({ mutation: { op: "delete", id: id(1), clientUpdatedAt: at } }),
    ).toEqual({ status: "conflict", reason: "quote-choice" });
  });
  it("persists one operation with the effect, and Undo removes both intents", () => {
    const row = JSON.parse(JSON.stringify(pending()));
    expect(row.mutation.quoteEffect).toEqual(effect());
    expect(undoPendingAnnotation(row, 9999)).toEqual({
      undone: true,
      snapshot: quote(),
      row: null,
    });
    expect(row.stage).toBe("undoable");
  });
  it("hidden sealing and failed transmission retain the same effect and cannot reopen Undo", () => {
    const row = pending(),
      hidden = claim(row),
      failed = releaseAnnotationClaim(hidden, "tab-a");
    const reloaded = JSON.parse(JSON.stringify(failed));
    expect(reloaded.stage).toBe("sealed");
    expect(undoPendingAnnotation(reloaded, 101).undone).toBe(false);
    const retried = claim(reloaded, "tab-b");
    expect(
      planAnnotationRequests(id(2), [hidden], "foreground").requests[0].json,
    ).toBe(
      planAnnotationRequests(id(2), [retried], "foreground").requests[0].json,
    );
    expect(retried.mutation).toMatchObject({ quoteEffect: effect() });
  });
  it("declining keeps the quote, while accepting produces one combined deletion decision", () => {
    expect(plan({ mutation: mutation(effect("keep-quote")) })).toMatchObject({
      status: "apply",
      deleteReadingQuoteId: null,
      annotation: { deletedAt: later },
      retired: { id: id(1) },
    });
    expect(plan()).toMatchObject({
      status: "apply",
      deleteReadingQuoteId: id(9),
      annotation: { deletedAt: later },
      retired: { id: id(1) },
    });
  });
  it("changed note/binding versions yield neither effect, using exact opaque equality", () => {
    expect(
      plan({
        binding: {
          ...binding(),
          noteVersion: "note:2026-10-09T12:00:00.000001Z",
        },
      }),
    ).toEqual({ status: "conflict", reason: "note-version" });
    expect(
      plan({ binding: { ...binding(), bindingVersion: "binding: 0001" } }),
    ).toEqual({ status: "conflict", reason: "binding-version" });
  });
  it("rejects unauthorized or cross-book/note bindings before producing any write", () => {
    expect(plan({ authorized: false })).toEqual({
      status: "conflict",
      reason: "ownership",
    });
    for (const patch of [
      { ebookId: id(8) },
      { annotationId: id(8) },
      { noteId: id(8) },
    ])
      expect(plan({ binding: { ...binding(), ...patch } })).toEqual({
        status: "conflict",
        reason: "binding",
      });
  });
  it("retry or a later competing effect never removes a quote retained by completed deletion", () => {
    const kept = plan({ mutation: mutation(effect("keep-quote")) });
    if (kept.status !== "apply") throw new Error("Expected composed delete");
    expect(plan({ current: kept.annotation, retired: kept.retired })).toEqual({
      status: "already-retired",
    });
    // Purged full tombstone still blocks a delayed delete-quote intent.
    expect(
      plan({ current: null, retired: kept.retired, binding: null }),
    ).toEqual({ status: "already-retired" });
    const removed = plan();
    if (removed.status !== "apply") throw new Error("Expected composed delete");
    expect(
      plan({
        current: removed.annotation,
        retired: removed.retired,
        binding: null,
      }),
    ).toEqual({ status: "already-retired" });
  });
  it("conflict retains both intents sealed; stale results cannot remove or release a newer claim", () => {
    const row = claim(),
      result = {
        operationId: row.operationId,
        revision: row.revision,
        token: "tab-a",
        status: "conflict" as const,
        reason: "note-version",
      };
    const conflict = settleAnnotationDeleteClaim(row, result)!;
    expect(conflict).toMatchObject({
      stage: "sealed",
      claim: null,
      mutation: { quoteEffect: effect() },
    });
    expect(undoPendingAnnotation(conflict, 101).undone).toBe(false);
    const retry = claim(conflict, "tab-b");
    expect(settleAnnotationDeleteClaim(retry, result)).toBe(retry);
    expect(
      settleAnnotationDeleteClaim(retry, {
        ...result,
        token: "tab-b",
        revision: 6,
        status: "committed",
      }),
    ).toBe(retry);
    expect(
      settleAnnotationDeleteClaim(retry, {
        ...result,
        token: "tab-b",
        status: "already-retired",
      }),
    ).toBeNull();
  });
  it("sizes the whole effect envelope and defers oversized Unicode data intact until foreground", () => {
    const large = { ...effect(), expectedBindingVersion: "🙂".repeat(20_000) },
      row = claim(pending(large));
    const lifecycle = planAnnotationRequests(id(2), [row], "lifecycle");
    expect(lifecycle.requests).toEqual([]);
    expect(lifecycle.deferred).toEqual([row]);
    const reloaded = JSON.parse(
      JSON.stringify(releaseAnnotationClaim(row, "tab-a")),
    );
    const request = planAnnotationRequests(
      id(2),
      [claim(reloaded)],
      "foreground",
    ).requests[0];
    expect(request.bytes).toBeGreaterThan(64 * 1024);
    expect(request.bytes).toBe(new TextEncoder().encode(request.json).length);
    expect(request.body.deletes[0]).toEqual({
      id: id(1),
      clientUpdatedAt: at,
      quoteEffect: large,
      operationId: "composed-delete",
      revision: 7,
    });
    expect(
      annotationBodySchema(Date.parse(at)).safeParse(request.body).success,
    ).toBe(true);
  });
  it("validates the composed wire identity and forbids executable or privileged extra fields", () => {
    const valid = planAnnotationRequests(id(2), [claim()], "foreground")
      .requests[0].body;
    const parsed = annotationBodySchema(Date.parse(at)).parse(valid);
    expect(parsed.deletes[0].quoteEffect).toEqual(effect());
    for (const patch of [
      { operationId: undefined },
      { revision: undefined },
      { revision: 0 },
      { quoteEffect: { ...effect(), run: "delete-now" } },
      { quoteEffect: { ...effect(), expectedNoteVersion: "" } },
    ])
      expect(
        annotationBodySchema(Date.parse(at)).safeParse({
          upserts: [],
          deletes: [{ ...valid.deletes[0], ...patch }],
        }).success,
      ).toBe(false);
  });
  it("tracker-origin deletion atomically plans a plain highlight without altering content, anchors or identity", () => {
    const current = quote();
    const result = planTrackerQuoteDelete({
      ebookId: id(2),
      authorized: true,
      current,
      retired: null,
      binding: binding(),
      effect: { ...effect(), action: "delete-quote" },
      color: "sage",
      serverTime: later,
    });
    expect(result).toEqual({
      status: "apply",
      deleteReadingQuoteId: id(9),
      annotation: {
        ...current,
        style: "highlight",
        color: "sage",
        updatedAt: later,
      },
    });
    expect(
      mergeAnnotation({
        ebookId: id(2),
        current,
        retired: null,
        mutation: put({ clientUpdatedAt: later }),
        serverTime: later,
        deviceId: id(4),
      }),
    ).toEqual({ action: "ignore", reason: "quote-privilege" });
    expect(
      planTrackerQuoteDelete({
        ebookId: id(2),
        authorized: true,
        current,
        retired: null,
        binding: { ...binding(), noteVersion: "changed" },
        effect: { ...effect(), action: "delete-quote" },
        color: "sage",
        serverTime: later,
      }),
    ).toEqual({ status: "conflict", reason: "note-version" });
    expect(
      planTrackerQuoteDelete({
        ebookId: id(2),
        authorized: true,
        current,
        retired: { id: id(1), ebookId: id(2), retiredAt: at },
        binding: binding(),
        effect: { ...effect(), action: "delete-quote" },
        color: "sage",
        serverTime: later,
      }),
    ).toEqual({ status: "conflict", reason: "retired" });
  });
});

describe("annotation serializer for the shared SLN-507 transport", () => {
  it("captures original device/file/body while leaving an undoable operation unclaimed", () => {
    const row = pending(),
      context = { fileId: id(3), expectedDeviceId: id(4) };
    const captured = serializeAnnotationOperation(row, context);
    expect(captured).toMatchObject({
      kind: "annotation",
      operationId: row.operationId,
      revision: 7,
      ebookId: id(2),
      ...context,
    });
    expect(JSON.parse(captured.body).deletes[0]).toMatchObject({
      clientUpdatedAt: at,
      quoteEffect: effect(),
    });
    expect(JSON.parse(JSON.stringify(captured))).toEqual(captured);
    expect(captured.deleteUndo).toEqual({
      state: "undoable",
      until: 10_000,
      snapshot: quote(),
    });
    const sealed = serializeAnnotationOperation(
      releaseAnnotationClaim(claim(row), "tab-a"),
      context,
    );
    expect(sealed.deleteUndo?.state).toBe("sealed");
    expect(sealed.body).toBe(captured.body);
    expect(row.stage).toBe("undoable");
    expect(row.claim).toBeNull();
  });
  it("mixed-file operations retain per-item identity and refuse replacement identities", () => {
    const first = pendingAnnotation({
      ebookId: id(2),
      operationId: "first",
      revision: 1,
      baseVersion: null,
      mutation: put(),
      now: 0,
    });
    const second = pendingAnnotation({
      ebookId: id(2),
      operationId: "second",
      revision: 2,
      baseVersion: null,
      mutation: put({ id: id(8), fileId: id(7), clientUpdatedAt: later }),
      now: 0,
    });
    const items = [
      serializeAnnotationOperation(first, {
        fileId: id(3),
        expectedDeviceId: id(4),
      }),
      serializeAnnotationOperation(second, {
        fileId: id(7),
        expectedDeviceId: id(4),
      }),
    ];
    expect(
      items.map((item) => [
        item.fileId,
        JSON.parse(item.body).upserts[0].fileId,
      ]),
    ).toEqual([
      [id(3), id(3)],
      [id(7), id(7)],
    ]);
    expect(JSON.parse(items[1].body).upserts[0].clientUpdatedAt).toBe(later);
    expect(() =>
      serializeAnnotationOperation(first, {
        fileId: id(7),
        expectedDeviceId: id(4),
      }),
    ).toThrow("mismatch");
    expect(() =>
      serializeAnnotationOperation(first, {
        fileId: id(3),
        expectedDeviceId: "",
      }),
    ).toThrow("identity");
  });
});
