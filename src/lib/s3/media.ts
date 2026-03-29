import { uploadToS3 } from "./covers";
import {
  goldMediaKey,
  goldMediaThumbnailKey,
  goldMediaOriginalKey,
  type MediaEntityType,
} from "./keys";
import type { MonochromeParams } from "@/lib/validations/media";

/** Per-type max dimensions (generous — we want gorgeous, sharp images) */
const MEDIA_DIMENSIONS: Record<string, { w: number; h: number }> = {
  poster: { w: 1600, h: 2400 },
  background: { w: 2560, h: 1440 },
  gallery: { w: 2400, h: 2400 },
};

/**
 * Process a raw image buffer into gold-tier media assets.
 * Returns S3 keys for both the full-size and thumbnail versions.
 */
export async function processAndUploadMedia(
  entityType: MediaEntityType,
  entityId: string,
  mediaType: string,
  fileId: string,
  buffer: Buffer,
): Promise<{ s3Key: string; thumbnailS3Key: string; width: number; height: number }> {
  const sharp = (await import("sharp")).default;
  const dims = MEDIA_DIMENSIONS[mediaType] ?? { w: 1600, h: 1600 };

  // Full-size image
  const fullImage = sharp(buffer).resize(dims.w, dims.h, {
    fit: "inside",
    withoutEnlargement: true,
  });
  const fullBuffer = await fullImage.webp({ quality: 90 }).toBuffer();
  const metadata = await sharp(fullBuffer).metadata();

  // Thumbnail (800px max — still sharp on retina displays)
  const thumbBuffer = await sharp(buffer)
    .resize(800, 1200, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  const s3Key = goldMediaKey(entityType, entityId, mediaType, fileId);
  const thumbnailS3Key = goldMediaThumbnailKey(entityType, entityId, mediaType, fileId);

  await Promise.all([
    uploadToS3(s3Key, fullBuffer, "image/webp"),
    uploadToS3(thumbnailS3Key, thumbBuffer, "image/webp"),
  ]);

  return {
    s3Key,
    thumbnailS3Key,
    width: metadata.width ?? 0,
    height: metadata.height ?? 0,
  };
}

// ── Author monochrome pipeline ──────────────────────────────────────────────

/**
 * Apply monochrome processing to an image buffer.
 * Pipeline order: grayscale → gamma → contrast → brightness → sharpen
 */
export async function applyMonochromeProcessing(
  buffer: Buffer,
  params: MonochromeParams,
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  let pipeline = sharp(buffer).grayscale();

  if (params.gamma !== 2.2) {
    pipeline = pipeline.gamma(params.gamma);
  }

  if (params.contrast !== 1.0) {
    pipeline = pipeline.linear(params.contrast, -(128 * (params.contrast - 1)));
  }

  if (params.brightness !== 1.0) {
    pipeline = pipeline.modulate({ brightness: params.brightness });
  }

  if (params.sharpness > 0) {
    pipeline = pipeline.sharpen({ sigma: params.sharpness });
  }

  return pipeline.toBuffer();
}

/**
 * Process an author image: store the color original, then create monochrome variant.
 */
export async function processAndUploadAuthorMedia(
  entityId: string,
  mediaType: string,
  fileId: string,
  buffer: Buffer,
  params: MonochromeParams,
): Promise<{
  s3Key: string;
  thumbnailS3Key: string;
  originalS3Key: string;
  width: number;
  height: number;
}> {
  const sharp = (await import("sharp")).default;
  const dims = MEDIA_DIMENSIONS[mediaType] ?? { w: 1600, h: 1600 };

  // 1. Resize original (color) to max dims and store
  const originalResized = await sharp(buffer)
    .resize(dims.w, dims.h, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer();

  const originalS3Key = goldMediaOriginalKey("author", entityId, mediaType, fileId);
  await uploadToS3(originalS3Key, originalResized, "image/webp");

  // 2. Apply monochrome processing
  const monoBuffer = await applyMonochromeProcessing(originalResized, params);

  // 3. Full-size processed image
  const fullBuffer = await sharp(monoBuffer).webp({ quality: 90 }).toBuffer();
  const metadata = await sharp(fullBuffer).metadata();

  // 4. Thumbnail (also monochrome)
  const thumbBuffer = await sharp(monoBuffer)
    .resize(800, 1200, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  const s3Key = goldMediaKey("author", entityId, mediaType, fileId);
  const thumbnailS3Key = goldMediaThumbnailKey("author", entityId, mediaType, fileId);

  await Promise.all([
    uploadToS3(s3Key, fullBuffer, "image/webp"),
    uploadToS3(thumbnailS3Key, thumbBuffer, "image/webp"),
  ]);

  return { s3Key, thumbnailS3Key, originalS3Key, width: metadata.width ?? 0, height: metadata.height ?? 0 };
}

/**
 * Re-process an existing author media item from its stored original.
 * Fetches the color original from S3, applies new monochrome params, re-uploads.
 */
export async function reprocessAuthorMedia(
  record: { s3Key: string; thumbnailS3Key: string | null; originalS3Key: string },
  params: MonochromeParams,
): Promise<{ width: number; height: number }> {
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { s3: s3Client, S3_BUCKET } = await import("./client");

  const obj = await s3Client.send(
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: record.originalS3Key }),
  );
  const bytes = await obj.Body!.transformToByteArray();
  const originalBuffer = Buffer.from(bytes);

  const sharp = (await import("sharp")).default;
  const monoBuffer = await applyMonochromeProcessing(originalBuffer, params);

  const fullBuffer = await sharp(monoBuffer).webp({ quality: 90 }).toBuffer();
  const metadata = await sharp(fullBuffer).metadata();

  const thumbBuffer = await sharp(monoBuffer)
    .resize(800, 1200, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  await Promise.all([
    uploadToS3(record.s3Key, fullBuffer, "image/webp"),
    ...(record.thumbnailS3Key
      ? [uploadToS3(record.thumbnailS3Key, thumbBuffer, "image/webp")]
      : []),
  ]);

  return { width: metadata.width ?? 0, height: metadata.height ?? 0 };
}
