import { checkedSourceSize, UPLOAD_LIMITS } from "./limits";
import { requireSha256, validateInspectorIdentity, INSPECTOR_PROTOCOL, requestRelativePath, type InspectorIdentity } from "./runtime-contract";
import { boundedJsonBytes } from "./bounded-json";
import type { PostgresUploadStore } from "./store";
import type { PrivateUploadSpool, SpoolAllocationAuthority } from "./private-spool";
import type { UploadIoGate } from "./io-gate";
import type { SupervisorOwner } from "./supervisor";

export interface InspectorWorkerRequest { protocol: number; identity: InspectorIdentity; name: string; bytes: number; sha256: string }
export const INSPECTOR_REQUEST_BYTES = 64 * 1024;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Inspector request object is malformed");
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).sort().join(",") !== keys.sort().join(",")) throw new Error("Inspector request fields differ");
}
function request(value: unknown): InspectorWorkerRequest {
  const raw = object(value); exactKeys(raw, ["protocol", "identity", "name", "bytes", "sha256"]);
  if (raw.protocol !== INSPECTOR_PROTOCOL || typeof raw.name !== "string" || raw.name.length < 1 || raw.name.length > 256
    || /[\x00-\x1f/\\]/.test(raw.name) || typeof raw.bytes !== "number" || typeof raw.sha256 !== "string") throw new Error("Inspector request binding differs");
  const identity = object(raw.identity); exactKeys(identity, ["volumeId", "bindingSha256", "fence"]);
  const fence = object(identity.fence); exactKeys(fence, ["operationId", "ownerToken", "ownerFence", "generation"]);
  validateInspectorIdentity(identity as unknown as InspectorIdentity); checkedSourceSize(raw.bytes); requireSha256(raw.sha256);
  return raw as unknown as InspectorWorkerRequest;
}
export function decodeInspectorRequest(bytes: Uint8Array): InspectorWorkerRequest {
  if (!bytes.length || bytes.length > INSPECTOR_REQUEST_BYTES) throw new Error("Inspector request exceeds its byte bound");
  return request(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
}
export function encodeInspectorRequest(value: InspectorWorkerRequest): Uint8Array {
  request(value); boundedJsonBytes(value, INSPECTOR_REQUEST_BYTES);
  return new TextEncoder().encode(JSON.stringify(value));
}

/** Original name comes from the immutable operation input, never a worker command. */
export async function writeInspectorRequest(input: {
  owner: SupervisorOwner; identity: InspectorIdentity; store: PostgresUploadStore; spool: PrivateUploadSpool;
  gate: UploadIoGate; authority: SpoolAllocationAuthority;
}): Promise<void> {
  await input.store.assertOperation(input.owner, input.identity.fence, Date.now());
  const stored = await input.store.transport(input.owner, input.identity.fence);
  if (!stored.transport.assembled || stored.transport.corrupt || typeof stored.input.name !== "string") throw new Error("Inspector lacks a bound durable original");
  const bytes = encodeInspectorRequest({ protocol: INSPECTOR_PROTOCOL, identity: input.identity, name: stored.input.name,
    bytes: stored.sourceBytes, sha256: stored.transport.assembled.sha256 });
  if (bytes.length > UPLOAD_LIMITS.partBytes) throw new Error("Inspector request exceeds its metadata grant");
  await input.spool.writeExclusive({ fence: input.identity.fence, relativePath: requestRelativePath(input.identity), bytes: bytes.length,
    stream: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
    gate: input.gate, authority: input.authority });
  await input.store.assertOperation(input.owner, input.identity.fence, Date.now());
}
