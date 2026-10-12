import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { serverEnv } from "@/lib/env";
import { s3, S3_BUCKET } from "./client";
import { bronzeCoverKey } from "./keys";
import { safeFetchImage } from "@/lib/net/safe-fetch";
import { previewDelete, previewGet, previewPut, previewS3Dir } from "./preview-dir";
import { allocateCoverStage, renderCoverPair, stageCoverPair, retainCoverAttempt, type VerifiedCoverStage } from "./cover-stage";

/** Upload a buffer to S3 */
export async function uploadToS3(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
) {
  const dir = previewS3Dir();
  if (dir) return previewPut(dir, key, body);
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return key;
}

/** Delete an object from S3 */
export async function deleteFromS3(key: string) {
  const dir = previewS3Dir();
  if (dir) return previewDelete(dir, key);
  await s3.send(
    new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }),
  );
}

/** Get an S3 object as a readable stream with metadata */
export async function getS3Object(key: string): Promise<{
  body: GetObjectCommandOutput["Body"];
  contentType: string | undefined;
  contentLength: number | undefined;
}> {
  const dir = previewS3Dir();
  if (dir) {
    const object = await previewGet(dir, key);
    return { ...object, body: object.body as unknown as GetObjectCommandOutput["Body"] };
  }
  const response = await s3.send(
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
  );
  return {
    body: response.Body,
    contentType: response.ContentType,
    contentLength: response.ContentLength,
  };
}

/** Get a pre-signed URL for uploading to S3 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600,
): Promise<string> {
  // Disable SDK checksum headers -- browsers can't send them on PUT,
  // causing S3 to reject the upload with a signature mismatch.
  const s3NoChecksum =
    noChecksumClient ?? new S3Client({
      region: serverEnv().AWS_REGION,
      credentials: {
        accessKeyId: serverEnv().AWS_ACCESS_KEY_ID,
        secretAccessKey: serverEnv().AWS_SECRET_ACCESS_KEY,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  noChecksumClient = s3NoChecksum;

  return getSignedUrl(
    s3NoChecksum,
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn },
  );
}

// Cached client without automatic checksums (for browser-facing presigned URLs)
let noChecksumClient: S3Client | null = null;

/**
 * Download a cover image from a URL, process it with sharp,
 * and upload both full cover and thumbnail to S3 gold/.
 * Returns the S3 keys for both, and the cover's colour palette (null when it
 * could not be read; the cover is stored all the same). Callers write the
 * palette with the keys: `editionCoverPaletteFields(cover.palette)`.
 */
export async function processAndUploadCover(
  editionId: string,
  sourceUrl: string,
): Promise<VerifiedCoverStage | null> {
  const allocation = allocateCoverStage({ editionId, source: { kind: "url", url: sourceUrl } });
  try {
    const { buffer } = await safeFetchImage(sourceUrl, { allowHttp: true });
    const { buffers, palette } = await renderCoverPair(buffer);
    return await stageCoverPair(allocation, buffers, palette);
  } catch (err) {
    retainCoverAttempt(allocation, "download, rendering or stage outcome uncertain");
    console.warn(`[covers] cover not stored for edition ${editionId}: ${(err as Error)?.message ?? err}`);
    return null;
  }
}

/**
 * Store a raw cover image in bronze/ before processing.
 */
export async function storeRawCover(
  editionId: string,
  buffer: Buffer,
  ext: string,
  contentType: string,
) {
  const key = bronzeCoverKey(editionId, ext);
  await uploadToS3(key, buffer, contentType);
  return key;
}
