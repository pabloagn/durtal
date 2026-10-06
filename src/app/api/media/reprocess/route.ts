import { NextResponse } from "next/server";
import { requireAdminToken } from "@/lib/api/admin";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { isNotNull } from "drizzle-orm";
import { uploadToS3 } from "@/lib/s3/covers";
import { readS3Object } from "@/lib/s3/read-object";


/**
 * POST /api/media/reprocess
 *
 * Re-processes all media items: fetches the full-size image from S3 gold/
 * and regenerates the thumbnail at the current (higher) resolution settings,
 * over the same key. No database row changes: the keys stay the same.
 *
 * This fixes thumbnails that were generated at too-low resolution.
 * The full-size images keep their current quality (can't upscale).
 */
export async function POST(req: Request) {
  const denied = requireAdminToken(req);
  if (denied) return denied;

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
        // The full-size image
        const buffer = await readS3Object(item.s3Key);

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
