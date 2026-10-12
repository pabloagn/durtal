import { createHash } from "node:crypto";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export const OPERATION_KINDS = ["batch", "upload", "admit", "complete", "cancel", "retry", "restore", "undo"] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_BYTES = 64 * 1024;

/** JSON only: no getters, toJSON hooks, cycles, sparse arrays or nonfinite numbers. */
export function canonicalJson(value: unknown, maxBytes = MAX_BYTES): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 128 * 1024) throw new Error("Invalid JSON byte limit");
  const ancestors = new Set<object>();
  let visited = 0;
  let encodedBytes = 0;
  const take = (text: string) => {
    encodedBytes += Buffer.byteLength(text);
    if (encodedBytes > maxBytes) throw new Error("Request exceeds its byte limit");
    return text;
  };
  function encode(input: unknown, depth: number): string {
    if (++visited > 10_000 || depth > 16) throw new Error("Request structure exceeds its limit");
    if (input === null) return take("null");
    if (typeof input === "boolean") return take(String(input));
    if (typeof input === "number" && Number.isFinite(input)) return take(JSON.stringify(input));
    if (typeof input === "string") {
      if (Buffer.byteLength(input) > maxBytes) throw new Error("Request exceeds its byte limit");
      return take(JSON.stringify(input));
    }
    if (typeof input !== "object" || ancestors.has(input)) throw new Error("Request must be acyclic JSON");
    if (!Array.isArray(input) && Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
      throw new Error("Request must contain plain JSON objects");
    if (Object.getOwnPropertySymbols(input).length) throw new Error("Request must contain JSON keys");
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Object.values(descriptors).some((descriptor) => !Object.hasOwn(descriptor, "value"))) throw new Error("Request cannot contain accessors");
    ancestors.add(input);
    try {
      if (Array.isArray(input)) {
        const keys = Object.keys(input);
        if (Object.getPrototypeOf(input) !== Array.prototype || input.length > 512
          || keys.length !== input.length || keys.some((key, index) => key !== String(index))) throw new Error("Invalid request array");
        const opening = take("[");
        const items = keys.map((key, index) => `${index ? take(",") : ""}${encode(descriptors[key].value, depth + 1)}`);
        return `${opening}${items.join("")}${take("]")}`;
      }
      const keys = Object.keys(input).sort();
      if (keys.length > 512) throw new Error("Too many request keys");
      const opening = take("{");
      return `${opening}${keys.map((key, index) => {
        if (Buffer.byteLength(key) > 256) throw new Error("Request key exceeds its limit");
        return `${index ? take(",") : ""}${take(JSON.stringify(key))}${take(":")}${encode(descriptors[key].value, depth + 1)}`;
      }).join("")}${take("}")}`;
    } finally {
      ancestors.delete(input);
    }
  }
  const encoded = encode(value, 0);
  if (Buffer.byteLength(encoded) > maxBytes) throw new Error("Request exceeds its byte limit");
  return encoded;
}

export interface IdempotencyRequest {
  key: string;
  kind: OperationKind;
  protocolVersion: 1;
  targetFingerprint: string;
  bindingSha256: string;
  parentOperationId: string | null;
  input: JsonValue;
}

export interface PreparedRequest {
  key: string;
  kind: OperationKind;
  requestSha256: string;
  targetFingerprint: string;
  bindingSha256: string;
}

export function prepareIdempotencyRequest(request: IdempotencyRequest): PreparedRequest {
  if (!UUID.test(request.key) || (request.parentOperationId !== null && !UUID.test(request.parentOperationId))) throw new Error("Invalid operation key");
  if (!OPERATION_KINDS.includes(request.kind) || request.protocolVersion !== 1) throw new Error("Unknown upload operation protocol");
  if (!SHA256.test(request.targetFingerprint) || !SHA256.test(request.bindingSha256)) throw new Error("Invalid operation fingerprint");
  const encoded = canonicalJson({
    kind: request.kind, protocolVersion: request.protocolVersion,
    targetFingerprint: request.targetFingerprint, bindingSha256: request.bindingSha256,
    parentOperationId: request.parentOperationId, input: request.input,
  });
  return {
    key: request.key, kind: request.kind,
    requestSha256: createHash("sha256").update(encoded).digest("hex"),
    targetFingerprint: request.targetFingerprint, bindingSha256: request.bindingSha256,
  };
}

export interface OperationReceipt {
  status: number;
  result: JsonValue;
}

export interface PersistedOperation extends PreparedRequest {
  id: string;
  effectCommitted: boolean;
  receipt: OperationReceipt | null;
}

/** Call after access checks but before current target freshness checks. */
export function lookupOperation(request: PreparedRequest, saved: PersistedOperation | null):
  | { kind: "new" }
  | { kind: "pending"; operationId: string }
  | { kind: "replay"; operationId: string; receipt: OperationReceipt }
  | { kind: "conflict" } {
  if (!saved) return { kind: "new" };
  if (request.key !== saved.key || request.kind !== saved.kind || request.requestSha256 !== saved.requestSha256
    || request.bindingSha256 !== saved.bindingSha256 || request.targetFingerprint !== saved.targetFingerprint) return { kind: "conflict" };
  if (!UUID.test(saved.id)) throw new Error("Invalid persisted operation id");
  if (saved.effectCommitted && !saved.receipt) throw new Error("Committed operation has no receipt");
  if (!saved.receipt) return { kind: "pending", operationId: saved.id };
  if (!Number.isInteger(saved.receipt.status) || saved.receipt.status < 200 || saved.receipt.status > 599) throw new Error("Invalid receipt status");
  canonicalJson(saved.receipt.result, 128 * 1024);
  return { kind: "replay", operationId: saved.id, receipt: saved.receipt };
}
