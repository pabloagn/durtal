import { describe, expect, it } from "vitest";
import {
  mergeAnnotation,
  annotationFileMatches,
} from "@/lib/reader/sync/annotation-merge";
import type { AnnotationMutation } from "@/lib/reader/annotations";
import { annotation, at, id, later, locator, put } from "./fixtures/annotation";
const merge = (mutation: AnnotationMutation, current = annotation()) =>
  mergeAnnotation({
    ebookId: id(2),
    current,
    retired: null,
    mutation,
    serverTime: later,
    deviceId: id(4),
  });

describe("annotation merge policy", () => {
  it("accepts only strictly newer edits and keeps equal replay unchanged", () => {
    expect(merge(put())).toEqual({ action: "ignore", reason: "equal" });
    expect(merge(put({ clientUpdatedAt: "2026-10-09T11:59:59Z" }))).toEqual({
      action: "ignore",
      reason: "older",
    });
    expect(
      merge(put({ clientUpdatedAt: later, note: "New thought" })),
    ).toMatchObject({
      action: "apply",
      annotation: { note: "New thought", clientUpdatedAt: later },
    });
  });
  it("an older delete is final and cannot be resurrected by a newer edit", () => {
    const deleted = merge({
      op: "delete",
      id: id(1),
      clientUpdatedAt: "2026-10-09T11:00:00Z",
    });
    expect(deleted).toMatchObject({
      action: "apply",
      annotation: { deletedAt: later, clientUpdatedAt: at },
    });
    if (deleted.action !== "apply") throw new Error("Expected delete");
    expect(
      mergeAnnotation({
        ebookId: id(2),
        current: deleted.annotation,
        retired: deleted.retired,
        mutation: put({ clientUpdatedAt: "2026-10-10T00:00:00Z" }),
        serverTime: later,
        deviceId: null,
      }),
    ).toEqual({ action: "ignore", reason: "deleted" });
    // Actual purge removes the row, but the permanent retirement identity remains.
    expect(
      mergeAnnotation({
        ebookId: id(2),
        current: null,
        retired: deleted.retired,
        mutation: put({ clientUpdatedAt: "2027-01-10T00:00:00Z" }),
        serverTime: "2027-01-10T00:00:00Z",
        deviceId: null,
      }),
    ).toEqual({ action: "ignore", reason: "deleted" });
  });
  it("delete-before-create retires even an absent id", () => {
    const result = mergeAnnotation({
      ebookId: id(2),
      current: null,
      retired: null,
      mutation: { op: "delete", id: id(1), clientUpdatedAt: at },
      serverTime: later,
      deviceId: null,
    });
    expect(result).toMatchObject({
      action: "apply",
      annotation: null,
      retired: { id: id(1), ebookId: id(2) },
    });
  });
  it("a repeated tombstone does not change its content or timestamps", () => {
    const current = annotation({ deletedAt: at });
    expect(
      merge({ op: "delete", id: id(1), clientUpdatedAt: later }, current),
    ).toMatchObject({
      action: "apply",
      annotation: current,
      retired: { retiredAt: at },
    });
  });
  it("rejects cross-book active and retired ids and mismatched identity", () => {
    expect(merge(put(), annotation({ ebookId: id(9) }))).toEqual({
      action: "ignore",
      reason: "wrong-ebook",
    });
    expect(merge(put({ id: id(9) }))).toEqual({
      action: "ignore",
      reason: "wrong-id",
    });
    expect(
      mergeAnnotation({
        ebookId: id(2),
        current: null,
        retired: { id: id(1), ebookId: id(9), retiredAt: at },
        mutation: put(),
        serverTime: at,
        deviceId: null,
      }),
    ).toEqual({ action: "ignore", reason: "wrong-ebook" });
    expect(
      annotationFileMatches(id(2), id(3), locator, {
        id: id(3),
        ebookId: id(9),
        sha256: locator.fileHash,
      }),
    ).toBe(false);
    expect(
      annotationFileMatches(id(2), id(3), locator, {
        id: id(3),
        ebookId: id(2),
        sha256: "b".repeat(64),
      }),
    ).toBe(false);
  });
  it("preserves quote privilege while allowing a newer note patch", () => {
    const quote = annotation({ style: "quote", color: null });
    expect(merge(put({ clientUpdatedAt: later }), quote)).toEqual({
      action: "ignore",
      reason: "quote-privilege",
    });
    expect(
      merge(
        {
          op: "note",
          id: id(1),
          note: "Quote thought",
          clientUpdatedAt: later,
        },
        quote,
      ),
    ).toMatchObject({
      action: "apply",
      annotation: { style: "quote", color: null, note: "Quote thought" },
    });
  });
  it("healing is a compare-and-set anchor patch that preserves notes and edit time", () => {
    const patch = {
      op: "reanchor" as const,
      id: id(1),
      fileId: id(8),
      expectedFileId: id(3),
      expectedClientUpdatedAt: at,
      locator: { ...locator, fileHash: "b".repeat(64) },
      anchorState: "healed" as const,
    };
    expect(merge(patch)).toMatchObject({
      action: "apply",
      annotation: {
        fileId: id(8),
        anchorState: "healed",
        note: "My thought",
        clientUpdatedAt: at,
      },
    });
    expect(
      merge(patch, annotation({ clientUpdatedAt: later, note: "Remote edit" })),
    ).toEqual({ action: "ignore", reason: "anchor-changed" });
    expect(
      merge(patch, annotation({ style: "quote", color: null })),
    ).toMatchObject({
      action: "apply",
      annotation: { style: "quote", color: null },
    });
  });
  it("recolouring cannot move a healed/orphaned anchor or silently change the passage", () => {
    const current = annotation({
      fileId: id(8),
      anchorState: "orphaned",
      chapter: null,
    });
    expect(
      merge(
        put({ clientUpdatedAt: later, color: "sage", fileId: id(3) }),
        current,
      ),
    ).toMatchObject({
      action: "apply",
      annotation: {
        fileId: id(8),
        anchorState: "orphaned",
        color: "sage",
        chapter: null,
      },
    });
    expect(
      merge(put({ clientUpdatedAt: later, text: "Replacement passage" })),
    ).toEqual({ action: "ignore", reason: "immutable-text" });
  });
});
