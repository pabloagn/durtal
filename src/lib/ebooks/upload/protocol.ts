import { z } from "zod/v4";
import { UPLOAD_LIMITS } from "./limits";
import { expectedPartBytes, partCount } from "./parts";

const uuid = z.uuid().transform((value) => value.toLowerCase());
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const generation = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const name = z.string().min(1).max(256).regex(/^[^\x00-\x1f\x7f/\\]+$/);
export const uploadTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("new") }),
  z.strictObject({ kind: z.literal("add_format"), ebookId: uuid, beforeFingerprint: sha256 }),
  z.strictObject({ kind: z.literal("replace"), ebookId: uuid, fileId: uuid, beforeFingerprint: sha256 }),
]);
export type UploadTarget = z.output<typeof uploadTargetSchema>;
export const createUploadBatchSchema = z.strictObject({
  key: uuid, protocol: z.literal(1), files: z.array(z.strictObject({
    name, bytes: z.number().int().min(1).max(UPLOAD_LIMITS.sourceBytes), sha256, target: uploadTargetSchema,
  })).min(1).max(UPLOAD_LIMITS.filesPerBatch),
});
export type CreateUploadBatch = z.output<typeof createUploadBatchSchema>;

export const uploadCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("admit"), key: uuid, generation }),
  z.strictObject({ action: z.literal("complete"), key: uuid, generation, sha256 }),
  z.strictObject({ action: z.literal("prepare"), key: uuid }),
  z.strictObject({ action: z.literal("confirm"), key: uuid, previewToken: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ action: z.literal("cancel"), key: uuid }),
  z.strictObject({ action: z.literal("retry"), key: uuid }),
  z.strictObject({ action: z.literal("restore"), key: uuid, originalOperationId: uuid, fileId: uuid, beforeFingerprint: sha256 }),
  z.strictObject({ action: z.literal("undo"), key: uuid, originalOperationId: uuid }),
]);
export type UploadCommand = z.output<typeof uploadCommandSchema>;
export const uploadPartSchema = z.strictObject({ number: z.number().int().min(1).max(512), bytes: z.number().int().min(1).max(UPLOAD_LIMITS.partBytes), sha256 });
const state = z.enum(["queued", "admitted", "receiving", "ready", "processing", "quiescing", "completed", "failed", "canceled", "expired"]);
const itemShape = z.strictObject({
  id: uuid, name, bytes: z.number().int().min(1).max(UPLOAD_LIMITS.sourceBytes), sha256, target: uploadTargetSchema,
  generation, state, acknowledged: z.array(uploadPartSchema).max(512),
  retainedUntil: z.string().max(40).datetime({ offset: true }).nullable(), message: z.string().max(900).nullable(),
  ebookId: uuid.nullable(), fileId: uuid.nullable(),
  originalOperationId: uuid.nullable(), currentFingerprint: sha256.nullable(), undoAvailable: z.boolean(),
});
export const uploadItemViewSchema = itemShape.superRefine((item, context) => {
  const seen = new Set<number>();
  for (const part of item.acknowledged) {
    if (seen.has(part.number) || part.number > partCount(item.bytes) || part.bytes !== expectedPartBytes(item.bytes, part.number)) {
      context.addIssue({ code: "custom", message: "Upload receipts differ from the source envelope", path: ["acknowledged"] }); return;
    }
    seen.add(part.number);
  }
});
export type UploadItemView = z.output<typeof uploadItemViewSchema>;
/** Poll metadata only. Fetch the at-most-512 receipts once when resuming an item. */
export const uploadItemSummarySchema = itemShape.omit({ acknowledged: true }).extend({
  acknowledgedBytes: z.number().int().min(0).max(UPLOAD_LIMITS.sourceBytes),
}).refine((item) => item.acknowledgedBytes <= item.bytes, "Acknowledged bytes exceed the source");
export type UploadItemSummary = z.output<typeof uploadItemSummarySchema>;
export const uploadBatchViewSchema = z.strictObject({ id: uuid, key: uuid, runId: uuid, items: z.array(uploadItemSummarySchema).max(UPLOAD_LIMITS.filesPerBatch) })
  .refine((batch) => new Set(batch.items.map((item) => item.id)).size === batch.items.length, "Upload item identities must be unique");
export type UploadBatchView = z.output<typeof uploadBatchViewSchema>;
export const uploadOutcomeSchema = z.strictObject({
  operationId: uuid, key: uuid, status: z.number().int().min(200).max(599), message: z.string().max(900),
  preview: z.strictObject({ token: z.string().regex(/^[a-f0-9]{64}$/), effect: z.string().max(2000), expiresAt: z.string().max(40).datetime({ offset: true }) }).nullable(),
});
export type UploadOutcome = z.output<typeof uploadOutcomeSchema>;

const uploadErrorBrand = Symbol.for("durtal.ebook-upload.error.v1");
export class UploadError extends Error {
  readonly [uploadErrorBrand] = true;
  constructor(readonly status: 400 | 403 | 404 | 409 | 413 | 503, readonly code: string, message: string) { super(message); }
}
/** The app's startup (src/instrumentation.ts) installs the upload client from
 * its own bundle, so its errors are another copy of this class: check the brand. */
export function isUploadError(error: unknown): error is UploadError {
  return error instanceof UploadError || (error instanceof Error && (error as unknown as Record<symbol, unknown>)[uploadErrorBrand] === true);
}
