import { uploadToS3 } from "./covers";
import { goldMediaKey, goldMediaThumbnailKey } from "./keys";

/** Per-type max dimensions */
const MEDIA_DIMENSIONS: Record<string, { w: number; h: number }> = {
  poster: { w: 800, h: 1200 },
  background: { w: 1920, h: 1080 },
  gallery: { w: 1600, h: 1600 },
};

/**
 * Process a raw image buffer into gold-tier media assets.
 * Returns S3 keys for both the full-size and thumbnail versions.
 */
export async function processAndUploadMedia(
  entityType: "work" | "author",
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
  const fullBuffer = await fullImage.webp({ quality: 85 }).toBuffer();
  const metadata = await sharp(fullBuffer).metadata();

  // Thumbnail (max 400px wide)
  const thumbBuffer = await sharp(buffer)
    .resize(400, 400, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 75 })
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
