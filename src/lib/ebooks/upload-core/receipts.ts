import { createHash, randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { canonicalJson, prepareIdempotencyRequest, type OperationKind, type PreparedRequest } from "../upload/idempotency";
import { createUploadBatchSchema, uploadBatchViewSchema, uploadCommandSchema, uploadOutcomeSchema,
  type UploadCommand, type UploadOutcome, type UploadBatchView, type CreateUploadBatch } from "../upload/protocol";
import type { UploadCoreContext } from "../upload/core-contract";
import { databaseFingerprint } from "../ingest/command";
import type { UploadOriginalEffect } from "./atomic-contract";

export const uploadCoreHash = (value: unknown) => createHash("sha256").update(canonicalJson(value, 128 * 1024)).digest("hex");
export function uploadTargetFingerprint(planningUrl: string): string {
  return uploadCoreHash({ namespace: "durtal.upload.target.v1", database: databaseFingerprint(planningUrl) });
}
export function commandKind(input: UploadCommand): OperationKind {
  // Existing0088 keeps its accepted kind language. Full action/request hash
  // distinguishes preparation/confirmation companions from complete jobs.
  return input.action === "prepare" || input.action === "confirm" ? "complete" : input.action;
}
export function batchRequest(input: CreateUploadBatch, context: UploadCoreContext): PreparedRequest {
  return prepareIdempotencyRequest({ key: input.key, kind: "batch", protocolVersion: 1,
    targetFingerprint: context.targetFingerprint, bindingSha256: context.bindingSha256,
    parentOperationId: null, input: JSON.parse(JSON.stringify(createUploadBatchSchema.parse(input))) });
}
export function commandRequest(uploadId: string, input: UploadCommand, context: UploadCoreContext): PreparedRequest {
  return prepareIdempotencyRequest({ key: input.key, kind: commandKind(input), protocolVersion: 1,
    targetFingerprint: context.targetFingerprint, bindingSha256: context.bindingSha256,
    parentOperationId: z.uuid().parse(uploadId), input: JSON.parse(JSON.stringify(uploadCommandSchema.parse(input))) });
}
export function childKey(batchKey: string, index: number): string {
  const hash = uploadCoreHash({ namespace: "durtal.upload.child.v1", batchKey: z.uuid().parse(batchKey), index });
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-8${hash.slice(13,16)}-${((parseInt(hash[16],16)&3)|8).toString(16)}${hash.slice(17,20)}-${hash.slice(20,32)}`;
}
export interface UploadCoreReceipt {
  version: 1; request: PreparedRequest; operationId: string; parentOperationId: string | null;
  status: number; result: UploadOutcome | UploadBatchView; effect: UploadOriginalEffect | null;
  inspectionSha256?: string;
}
const requestSchema = z.strictObject({ key: z.uuid(), kind: z.enum(["batch","upload","admit","complete","cancel","retry","restore","undo"]),
  requestSha256: z.string().regex(/^[a-f0-9]{64}$/), targetFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  bindingSha256: z.string().regex(/^[a-f0-9]{64}$/) });
export function readUploadCoreReceipt(input: unknown): UploadCoreReceipt {
  const root = z.strictObject({ version: z.literal(1), request: requestSchema, operationId: z.uuid(),
    parentOperationId: z.uuid().nullable(), status: z.number().int().min(200).max(599),
    result: z.unknown(), effect: z.unknown().nullable(),
    inspectionSha256:z.string().regex(/^[a-f0-9]{64}$/).optional() }).parse(input);
  canonicalJson(root, 128 * 1024);
  const result = root.request.kind === "batch" ? uploadBatchViewSchema.parse(root.result) : uploadOutcomeSchema.parse(root.result);
  if (result.key !== root.request.key || ("status" in result && (result.status !== root.status || result.operationId !== root.operationId)))
    throw new Error("Permanent upload receipt differs from its operation");
  if (root.request.kind === "batch" && (root.status !== 201 || root.parentOperationId !== null ||
      !("id" in result) || result.id !== root.operationId || root.effect !== null))
    throw new Error("Upload creation receipt has invalid scope");
  if (root.inspectionSha256!==undefined && (root.request.kind!=="upload" || root.parentOperationId===null || root.effect!==null))
    throw new Error("Inspection receipt has invalid scope");
  let effect: UploadOriginalEffect | null = null;
  if (root.effect !== null) {
    // Native494 undo shape is data, never a capability or proof of currentness.
    const parsed = z.strictObject({ commandId: z.uuid(), key: z.uuid(), requestSha256: z.string().regex(/^[a-f0-9]{64}$/),
      effectSha256: z.string().regex(/^[a-f0-9]{64}$/), afterTargetSha256: z.string().regex(/^[a-f0-9]{64}$/),
      afterReaderSha256: z.string().regex(/^[a-f0-9]{64}$/), undo: z.strictObject({ ebookId: z.uuid(), createdEbook: z.boolean(),
        fileIds: z.array(z.uuid()).max(50), replaced: z.array(z.strictObject({ fileId: z.uuid(), previousStatus: z.string().max(40) })).max(50),
        preferredBefore: z.uuid().nullable(), coverBefore: z.string().nullable(), preferredAfter: z.uuid().nullable(), coverAfter: z.string().nullable(),
        updatedBefore: z.string().nullable().optional(), at: z.string() }) }).parse(root.effect);
    if (parsed.commandId !== root.operationId || parsed.key !== root.request.key || parsed.requestSha256 !== root.request.requestSha256)
      throw new Error("Upload effect receipt belongs to another command");
    effect = parsed;
  }
  return { ...root, result, effect };
}
export const newUploadIdentity = () => randomUUID();
