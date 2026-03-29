import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { eq, isNotNull } from "drizzle-orm";
import { uploadToS3 } from "@/lib/s3/covers";
import { s3, S3_BUCKET } from "@/lib/s3/client";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { goldMediaThumbnailKey } from "@/lib/s3/keys";

/**
 * POST /api/media/reprocess
 *
 * Re-processes all media items: fetches the full-size image from S3 gold/,
 * regenerates the thumbnail at the current (higher) resolution settings,
 * and updates the DB record.
 *
 * This fixes thumbnails that were generated at too-low resolution.
 * The full-size images keep their current quality (can't upscale).
 */
export async function POST() {
  try {
    const allMedia = await db
      .select({
        id: media.id,
        s3Key: media.s3Key,
        thumbnailS3Key: media.thumbnailS3Key,
        type: media.type,
      })
      .from(media)
      .where(isNotNull(media.s3Key));

    const sharp = (await import("sharp")).default;

    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const item of allMedia) {
      try {
        // Fetch the full-size image from S3
        const obj = await s3.send(
          new GetObjectCommand({ Bucket: S3_BUCKET, Key: item.s3Key }),
        );
        const bytes = await obj.Body!.transformToByteArray();
        const buffer = Buffer.from(bytes);

        // Regenerate thumbnail at higher resolution
        const thumbBuffer = await sharp(buffer)
          .resize(800, 1200, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();

        // Upload new thumbnail (overwrite existing)
        if (item.thumbnailS3Key) {
          await uploadToS3(item.thumbnailS3Key, thumbBuffer, "image/webp");
        }

        success++;
      } catch (err) {
        failed++;
        errors.push(
          `${item.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return NextResponse.json({
      total: allMedia.length,
      success,
      failed,
      errors: errors.slice(0, 10),
    });
  } catch (err) {
    console.error("Reprocess media failed:", err);
    return NextResponse.json(
      { error: "Reprocess failed" },
      { status: 500 },
    );
  }
}
