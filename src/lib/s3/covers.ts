import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3, S3_BUCKET } from "./client";
import { goldCoverKey, goldThumbnailKey, bronzeCoverKey } from "./keys";

/** Upload a buffer to S3 */
export async function uploadToS3(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
) {
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
  await s3.send(
    new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }),
  );
}

/** Get a pre-signed URL for reading an S3 object */
export async function getPresignedReadUrl(
  key: string,
  expiresIn = 3600,
): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
    { expiresIn },
  );
}

/** Get an S3 object as a readable stream with metadata */
export async function getS3Object(key: string) {
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
      region: process.env.AWS_REGION ?? "us-east-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
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
 * Returns the S3 keys for both.
 */
export async function processAndUploadCover(
  editionId: string,
  sourceUrl: string,
): Promise<{ coverKey: string; thumbnailKey: string } | null> {
  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Dynamic import sharp (it's a native module)
    const sharp = (await import("sharp")).default;

    // Full cover: 1200x1800 max, webp (sharp on all displays)
    const coverBuffer = await sharp(buffer)
      .resize(1200, 1800, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer();

    // Thumbnail: 600x900 max, webp (crisp on retina)
    const thumbBuffer = await sharp(buffer)
      .resize(600, 900, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    const coverKey = goldCoverKey(editionId);
    const thumbnailKey = goldThumbnailKey(editionId);

    await Promise.all([
      uploadToS3(coverKey, coverBuffer, "image/webp"),
      uploadToS3(thumbnailKey, thumbBuffer, "image/webp"),
    ]);

    return { coverKey, thumbnailKey };
  } catch {
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
