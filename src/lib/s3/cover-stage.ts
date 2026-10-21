import { createHash, randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { s3, S3_BUCKET } from "./client";
import { goldCoverStageKeys } from "./keys";
import { previewGet, previewPutExclusive, previewS3Dir } from "./preview-dir";
import { extractColorPalette } from "@/lib/color/extract-palette";
import type { ColorPalette } from "@/lib/types";

export type CoverSource =
  | Readonly<{ kind: "url"; url: string }>
  | Readonly<{ kind: "ebook"; ebookId: string; key: string; sha256: string | null; size: number | null }>
  // A file chosen or dropped in the edition's cover editor (SLN-638)
  | Readonly<{ kind: "upload"; sha256: string; size: number }>
  | Readonly<{ kind: "adjustment"; key: string; sha256: string; size: number }>;

/** Allocation is safe before storage writes, for reservation/recovery receipts. */
export interface AllocatedCoverStage {
  readonly editionId: string;
  readonly attemptId: string;
  readonly operationId: string;
  readonly targetDatabase: string | null;
  readonly bucket: string;
  readonly source: CoverSource;
  readonly coverKey: string;
  readonly thumbnailKey: string;
}
export interface CoverObjectEvidence {
  readonly key: string;
  readonly sha256: string;
  readonly size: number;
}
/** Only this module issues a complete verified publication capability. It is
 * not reconstructed from persisted receipts or arbitrary key-pair objects. */
export interface VerifiedCoverStage extends AllocatedCoverStage {
  readonly cover: CoverObjectEvidence;
  readonly thumbnail: CoverObjectEvidence;
  readonly palette: ColorPalette | null;
}
const allocated = new WeakSet<object>();
const verified = new WeakSet<object>();
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

export function allocateCoverStage(input: {
  editionId: string;
  operationId?: string;
  targetDatabase?: string;
  source: CoverSource;
}): AllocatedCoverStage {
  const attemptId = randomUUID();
  const operationId = input.operationId ?? randomUUID();
  if (!operationId || (input.targetDatabase !== undefined && !input.targetDatabase))
    throw new Error("Missing cover operation/target identity");
  const source = input.source;
  if (source.kind === "url" ? !source.url
    : source.kind === "upload" || source.kind === "adjustment"
      ? !/^[0-9a-f]{64}$/.test(source.sha256) || !(source.size > 0) || (source.kind === "adjustment" && !source.key)
    : !source.ebookId || !source.key)
    throw new Error("Missing cover source identity");
  const stage = Object.freeze({
    editionId: input.editionId, attemptId, operationId,
    targetDatabase: input.targetDatabase ?? null, bucket: S3_BUCKET,
    source: Object.freeze({ ...input.source }),
    ...goldCoverStageKeys(input.editionId, attemptId),
  });
  allocated.add(stage);
  return stage;
}
export function requireAllocatedCover(stage: AllocatedCoverStage) {
  const keys = goldCoverStageKeys(stage.editionId, stage.attemptId);
  if (!allocated.has(stage) || stage.bucket !== S3_BUCKET ||
      stage.coverKey !== keys.coverKey || stage.thumbnailKey !== keys.thumbnailKey)
    throw new Error("Cover allocation is not bound to this catalogue target");
}
export function requireVerifiedCover(stage: VerifiedCoverStage, editionId: string, binding?: {
  operationId: string; targetDatabase: string; source: CoverSource;
}) {
  if (!verified.has(stage) || stage.editionId !== editionId || stage.bucket !== S3_BUCKET ||
      stage.cover.key !== stage.coverKey || stage.thumbnail.key !== stage.thumbnailKey ||
      (binding && (stage.operationId !== binding.operationId ||
        stage.targetDatabase !== binding.targetDatabase ||
        JSON.stringify(stage.source) !== JSON.stringify(binding.source))))
    throw new Error("Cover publication requires its complete verified owner/source/operation pair");
}

function evidence(key: string, bytes: Buffer): CoverObjectEvidence {
  if (!bytes.length || bytes.length > MAX_OUTPUT_BYTES)
    throw new Error("Cover output is empty or too large");
  return Object.freeze({ key, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length });
}
/** Verify actual catalogue bytes, not a nominal success or user metadata hash.
 * A bounded stream also protects against a preexisting oversized object. */
async function verifyStored(expected: CoverObjectEvidence) {
  const dir = previewS3Dir();
  const response = dir
    ? await previewGet(dir, expected.key)
    : await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: expected.key }));
  const length = "contentLength" in response ? response.contentLength : response.ContentLength;
  const body = "body" in response ? response.body : response.Body;
  if (!body) throw new Error("Stored cover body cannot be verified");
  const reader = body.transformToWebStream().getReader();
  const hash = createHash("sha256");
  let size = 0;
  try {
    if (length !== expected.size)
      throw new Error("Stored cover size changed or cannot be verified");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > expected.size) throw new Error("Stored cover exceeded its declared size");
      hash.update(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (size !== expected.size || hash.digest("hex") !== expected.sha256)
    throw new Error("Stored cover bytes differ from this immutable attempt");
}
async function putVerified(expected: CoverObjectEvidence, bytes: Buffer) {
  let writeError: unknown;
  try {
    const dir = previewS3Dir();
    if (dir) await previewPutExclusive(dir, expected.key, bytes);
    else await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET, Key: expected.key, Body: bytes, ContentType: "image/webp",
      IfNoneMatch: "*", ChecksumSHA256: Buffer.from(expected.sha256, "hex").toString("base64"),
    }));
  } catch (error) {
    // Preexisting identical bytes or a lost successful PUT acknowledgement can
    // be adopted only after actual-byte verification. Never retry an overwrite.
    writeError = error;
  }
  try { await verifyStored(expected); }
  catch (error) {
    throw new Error(`Cover stage verification failed: ${expected.key}`, { cause: writeError ?? error });
  }
}

function freezePalette(palette: ColorPalette): ColorPalette {
  const copy = JSON.parse(JSON.stringify(palette)) as ColorPalette;
  const freeze = (value: unknown): void => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  };
  freeze(copy);
  return copy;
}

export async function stageCoverPair(
  allocation: AllocatedCoverStage,
  buffers: { cover: Buffer; thumbnail: Buffer },
  palette: ColorPalette | null,
): Promise<VerifiedCoverStage> {
  requireAllocatedCover(allocation);
  // Validate both outputs before the first PUT. The two completed writes and
  // read-back hashes are required before issuing any publication capability.
  const cover = evidence(allocation.coverKey, buffers.cover);
  const thumbnail = evidence(allocation.thumbnailKey, buffers.thumbnail);
  await putVerified(cover, buffers.cover);
  await putVerified(thumbnail, buffers.thumbnail);
  const stage = Object.freeze({ ...allocation, cover, thumbnail,
    palette: palette ? freezePalette(palette) : null });
  verified.add(stage);
  return stage;
}
export async function renderCoverPair(bytes: Buffer) {
  const sharp = (await import("sharp")).default;
  const render = (width: number, height: number, quality: number) => sharp(bytes, {
    failOn: "error", limitInputPixels: 100_000_000,
  }).rotate().resize(width, height, { fit: "inside", withoutEnlargement: true })
    .webp({ quality }).toBuffer();
  const cover = await render(1200, 1800, 88);
  const thumbnail = await render(600, 900, 82);
  return { buffers: { cover, thumbnail }, palette: await extractColorPalette(thumbnail).catch(() => null) };
}
/** Retention is unconditional: no reference lookup can authorize external
 * deletion while concurrent publishers/aliases lack a durable pin protocol. */
export function retainCoverAttempt(stage: Pick<AllocatedCoverStage, "editionId" | "attemptId" | "operationId" | "bucket" | "targetDatabase" | "coverKey" | "thumbnailKey">, reason: string) {
  const recovery = { cleanupPending: true as const, reason,
    outcome: "unreconciled; candidate paths may be absent, staged or published" as const, editionId: stage.editionId,
    attemptId: stage.attemptId, operationId: stage.operationId,
    bucket: stage.bucket, targetDatabase: stage.targetDatabase,
    keys: [stage.coverKey, stage.thumbnailKey] };
  console.warn("[covers] retained attempt; reconciliation required", recovery);
  return recovery;
}
