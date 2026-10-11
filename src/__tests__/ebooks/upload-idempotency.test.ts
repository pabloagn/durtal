import { describe, expect, it } from "vitest";
import { canonicalJson, lookupOperation, prepareIdempotencyRequest, type IdempotencyRequest, type PersistedOperation } from "@/lib/ebooks/upload/idempotency";

const request = (): IdempotencyRequest => ({
  key: "11111111-1111-4111-8111-111111111111", kind: "batch", protocolVersion: 1,
  targetFingerprint: "a".repeat(64), bindingSha256: "b".repeat(64), parentOperationId: null,
  input: { files: [{ name: "Nadja.epub", size: 17, type: "application/epub+zip" }] },
});
const saved = (): PersistedOperation => ({ ...prepareIdempotencyRequest(request()),
  id: "22222222-2222-4222-8222-222222222222", effectCommitted: false, receipt: null });

describe("operation idempotency", () => {
  it("normalizes JSON object ordering without reordering a batch", () => {
    expect(canonicalJson({ b: 2, a: [{ y: "é", x: 1 }] })).toBe('{"a":[{"x":1,"y":"é"}],"b":2}');
    expect(canonicalJson({ x: [1, 2] })).not.toBe(canonicalJson({ x: [2, 1] }));
    expect(prepareIdempotencyRequest({ ...request(), input: { a: 1, b: 2 } }).requestSha256)
      .toBe(prepareIdempotencyRequest({ ...request(), input: { b: 2, a: 1 } }).requestSha256);
  });
  it("returns the original run/item IDs after a committed response is lost", () => {
    const operation = saved();
    operation.effectCommitted = true;
    operation.receipt = { status: 201, result: { runId: "original-run", itemIds: ["original-item"] } };
    const retry = lookupOperation(prepareIdempotencyRequest(request()), operation);
    expect(retry).toEqual({ kind: "replay", operationId: operation.id, receipt: operation.receipt });
  });
  it("returns the same pending operation instead of duplicating jobs", () => {
    expect(lookupOperation(prepareIdempotencyRequest(request()), null)).toEqual({ kind: "new" });
    expect(lookupOperation(prepareIdempotencyRequest(request()), saved())).toEqual({ kind: "pending", operationId: saved().id });
  });
  it.each([
    { kind: "restore" as const }, { targetFingerprint: "c".repeat(64) },
    { bindingSha256: "d".repeat(64) }, { input: { files: [] } },
    { parentOperationId: "33333333-3333-4333-8333-333333333333" },
  ])("refuses reusing the key for a different bound request %j", (change) => {
    expect(lookupOperation(prepareIdempotencyRequest({ ...request(), ...change }), saved())).toEqual({ kind: "conflict" });
  });
  it("replays a restore receipt against its original target fingerprint", () => {
    const restore = { ...request(), kind: "restore" as const, input: { fileId: "old-file" } };
    const operation = { ...saved(), ...prepareIdempotencyRequest(restore), effectCommitted: true,
      receipt: { status: 200, result: { preferredFileId: "old-file" } } };
    expect(lookupOperation(prepareIdempotencyRequest(restore), operation).kind).toBe("replay");
    expect(lookupOperation(prepareIdempotencyRequest({ ...restore, targetFingerprint: "e".repeat(64) }), operation).kind).toBe("conflict");
  });
  it("fails closed on committed effects without a persisted receipt or invalid statuses", () => {
    const bound = prepareIdempotencyRequest(request());
    expect(() => lookupOperation(bound, { ...saved(), effectCommitted: true })).toThrow("no receipt");
    expect(() => lookupOperation(bound, { ...saved(), receipt: { status: NaN, result: {} } })).toThrow("status");
  });
  it("replays a persisted refusal without turning it into a new attempt", () => {
    expect(lookupOperation(prepareIdempotencyRequest(request()), { ...saved(), receipt: { status: 409, result: { reason: "Target changed" } } }).kind).toBe("replay");
  });
  it("honors the larger bounded receipt budget without enlarging request input", () => {
    const result = { detail: "x".repeat(70_000) };
    expect(() => canonicalJson(result)).toThrow("byte limit");
    expect(lookupOperation(prepareIdempotencyRequest(request()), { ...saved(), effectCommitted: true, receipt: { status: 200, result } }).kind).toBe("replay");
    expect(() => lookupOperation(prepareIdempotencyRequest(request()), { ...saved(), receipt: { status: 200, result: { detail: "x".repeat(131_072) } } })).toThrow("byte limit");
  });
  it.each([undefined, NaN, Infinity, new Date(), () => 1, { value: undefined }])("rejects values outside plain JSON", (input) => {
    expect(() => canonicalJson(input)).toThrow();
  });
  it("refuses cycles, getters, sparse arrays and oversized encoded requests", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow("acyclic");
    let called = false;
    const accessor = Object.defineProperty({}, "x", { enumerable: true, get() { called = true; return 1; } });
    expect(() => canonicalJson(accessor)).toThrow("accessors");
    expect(called).toBe(false);
    expect(() => canonicalJson(new Array(1))).toThrow("array");
    const holeAndProperty = Object.assign(new Array(1), { x: 1 });
    expect(() => canonicalJson(holeAndProperty)).toThrow("array");
    expect(() => canonicalJson({ x: "é".repeat(32_768) })).toThrow("byte limit");
    expect(() => canonicalJson({ x: "\\".repeat(32_768) })).toThrow("byte limit");
  });
  it("validates UUID keys and protocol/binding fingerprints", () => {
    expect(() => prepareIdempotencyRequest({ ...request(), key: "run" })).toThrow("operation key");
    expect(() => prepareIdempotencyRequest({ ...request(), targetFingerprint: "hash" })).toThrow("fingerprint");
  });
});
