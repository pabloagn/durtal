import { z } from "zod/v4";
import { fingerprintUploadFile } from "./browser-sha256";
import { resumeParts } from "./parts";
import { UPLOAD_LIMITS } from "./limits";
import { createUploadBatchSchema, uploadCommandSchema, uploadOutcomeSchema, uploadPartSchema, type UploadItemView } from "./protocol";
import { admissionRefusalSchema, UploadAdmissionRefusal } from "./admission-refusal";

const pendingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("create"), body: createUploadBatchSchema }),
  z.strictObject({ kind: z.literal("command"), operationId: z.uuid(), body: uploadCommandSchema }),
]);
const sessionSchema = z.strictObject({ version: z.literal(1), batchId: z.uuid().nullable(), pending: pendingSchema.nullable(),
  priorBatches: z.array(z.uuid()).max(32).optional(), lastRefusal: admissionRefusalSchema.optional() });
export type UploadBrowserSession = z.output<typeof sessionSchema>;
export type PendingUploadRequest = NonNullable<UploadBrowserSession["pending"]>;
const STORAGE = "durtal.ebook-upload.v1";
/** A request the server answered with an error status: `definitive` when sending it again cannot change the answer. */
export class UploadHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
  /** 4xx (except timeout and rate limit) and 503 unavailable: the server refused it and applied nothing new (SLN-672) */
  get definitive(): boolean { return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429 || this.status === 503; }
}
export function readUploadSession(): UploadBrowserSession {
  const raw = localStorage.getItem(STORAGE);
  if (!raw) return { version: 1, batchId: null, pending: null };
  if (raw.length > 64 * 1024) throw new Error("The saved upload recovery record is too large.");
  if (new TextEncoder().encode(raw).length > 64 * 1024) throw new Error("The saved upload recovery record is too large.");
  return sessionSchema.parse(JSON.parse(raw));
}
export function writeUploadSession(session: UploadBrowserSession): void {
  const raw = JSON.stringify(sessionSchema.parse(session));
  if (new TextEncoder().encode(raw).length > 64 * 1024) throw new Error("The upload recovery record is too large.");
  localStorage.setItem(STORAGE, raw); // before sending: loss never invents a new key
}
function matchesRefusal(request: PendingUploadRequest, refusal: z.output<typeof admissionRefusalSchema>): boolean {
  return request.kind === "command" && request.body.action === "admit" && request.operationId === refusal.operationId
    && request.body.key === refusal.key && request.body.generation === refusal.generation;
}
export function settleUploadAdmissionRefusal(session: UploadBrowserSession, request: PendingUploadRequest, error: UploadAdmissionRefusal): UploadBrowserSession {
  if (!session.pending || JSON.stringify(session.pending) !== JSON.stringify(request) || !matchesRefusal(request, error.refusal))
    throw new Error("The admission refusal does not settle the saved request.");
  const storageKey = `durtal.ebook-upload.refusal.${error.refusal.key}`;
  const evidence = JSON.stringify({ request, refusal: error.refusal });
  const previous = localStorage.getItem(storageKey);
  if (previous && previous !== evidence) throw new Error("The saved admission refusal identity differs.");
  localStorage.setItem(storageKey, evidence); // save original facts before clearing uncertainty
  return { ...session, pending: null, lastRefusal: error.refusal };
}
/** The file chosen to resume an upload is not the one it started with */
export class UploadFileMismatch extends Error {}
/** Drops the saved request without sending it again. A batch it may have created stays on the server until it expires. */
export function discardUploadRequest(session: UploadBrowserSession): UploadBrowserSession {
  return { ...session, pending: null };
}
export function startAnotherUploadBatch(session: UploadBrowserSession): UploadBrowserSession {
  if (session.pending) throw new Error("Resolve the saved upload request before starting another batch.");
  const priorBatches = [...new Set([...(session.batchId ? [session.batchId] : []), ...(session.priorBatches ?? [])])].slice(0, 32);
  return { ...session, batchId: null, pending: null, priorBatches };
}
export async function uploadResponse(response: Response, allowReceipt = false, request?: PendingUploadRequest): Promise<unknown> {
  const reader = response.body?.getReader(); if (!reader) throw new Error("The upload response is empty.");
  const chunks: Uint8Array[] = []; let bytes = 0; let done = false;
  try {
    while (true) { const next = await reader.read(); if (next.done) { done = true; break; }
      bytes += next.value.length; if (bytes > UPLOAD_LIMITS.reportBytes) throw new Error("The upload response exceeds its limit."); chunks.push(next.value); }
    const joined = new Uint8Array(bytes); let at = 0; for (const chunk of chunks) { joined.set(chunk, at); at += chunk.length; }
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(joined));
    if (response.status === 409 && body.code === "generation_changed" && request) {
      const refusal = admissionRefusalSchema.safeParse(body.refusal);
      if (refusal.success && matchesRefusal(request, refusal.data)) throw new UploadAdmissionRefusal(refusal.data);
    }
    if (!response.ok && allowReceipt) {
      const receipt = uploadOutcomeSchema.safeParse(body);
      if (receipt.success && receipt.data.status === response.status) return receipt.data;
    }
    if (!response.ok) throw new UploadHttpError(response.status, typeof body.error === "string" ? body.error : typeof body.message === "string" ? body.message : "The upload request could not be completed.");
    return body;
  } finally { if (!done) await reader.cancel(); reader.releaseLock(); }
}
export async function sendUploadRequest(request: PendingUploadRequest): Promise<unknown> {
  return uploadResponse(await fetch(request.kind === "create" ? "/api/ebooks/uploads" : `/api/ebooks/upload-operations/${request.operationId}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(30_000), body: JSON.stringify(request.body),
  }), request.kind === "command", request);
}
/** Whole source and every retained part must match after reselection. Names and
 * timestamps never authorize resume. PUT concurrency is globally four here.
 */
export async function sendUploadParts(file: File, item: UploadItemView, signal: AbortSignal, acknowledged: (bytes: number) => void, beforeSend: () => Promise<unknown> = async () => {}): Promise<void> {
  if (file.size !== item.bytes) throw new UploadFileMismatch("This is a different file: its size differs from the one being uploaded.");
  const evidence = await fingerprintUploadFile(file, signal);
  if (evidence.sha256 !== item.sha256) throw new UploadFileMismatch("This is a different file: its contents differ from the one being uploaded.");
  const retained = new Set(item.acknowledged.map((part) => part.number));
  const missing = resumeParts({ sourceBytes: item.bytes, generation: item.generation, receipts: item.acknowledged }, item.generation,
    evidence.parts.filter((part) => retained.has(part.number)));
  let bytes = item.acknowledged.reduce((total, part) => total + part.bytes, 0); let cursor = 0;
  acknowledged(bytes);
  await beforeSend(); signal.throwIfAborted();
  const abort = new AbortController(); const combined = AbortSignal.any([signal, abort.signal]);
  const worker = async () => {
    while (cursor < missing.length) {
      combined.throwIfAborted(); const number = missing[cursor++]; const part = evidence.parts[number - 1];
      const raw = await uploadResponse(await fetch(`/api/ebooks/upload-operations/${item.id}/parts/${number}`, {
        method: "PUT", headers: { "Content-Type": "application/octet-stream", "X-Upload-Generation": String(item.generation), "X-Upload-Sha256": part.sha256 },
        credentials: "same-origin", cache: "no-store", signal: combined,
        body: file.slice((number - 1) * UPLOAD_LIMITS.partBytes, (number - 1) * UPLOAD_LIMITS.partBytes + part.bytes),
      }));
      const receipt = z.strictObject({ ...uploadPartSchema.shape, generation: z.literal(item.generation) }).parse(raw);
      if (receipt.number !== part.number || receipt.bytes !== part.bytes || receipt.sha256 !== part.sha256) throw new Error("The upload acknowledgement differs from the selected bytes.");
      bytes += part.bytes; acknowledged(bytes);
    }
  };
  const results = await Promise.allSettled(Array.from({ length: Math.min(UPLOAD_LIMITS.clientPartConcurrency, missing.length) }, () =>
    worker().catch((error) => { abort.abort(error); throw error; })));
  const failed = results.find((result) => result.status === "rejected"); if (failed?.status === "rejected") throw failed.reason;
}
