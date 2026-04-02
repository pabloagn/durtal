import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { extractColorPalette } from "@/lib/color/extract-palette";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3, S3_BUCKET } from "@/lib/s3/client";

/**
 * POST /api/media/backfill-palettes
 *
 * Extracts color palettes for all poster media records that don't have one.
 * Processes sequentially to avoid overwhelming S3.
 * Returns a summary of how many were processed.
 */
export async function POST() {
  try {
    // Find all poster media without a color palette
    const posters = await db.query.media.findMany({
      where: and(
        eq(media.type, "poster"),
        isNull(media.colorPalette),
      ),
    });

    let processed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const poster of posters) {
      try {
        // Download from S3
        const obj = await s3.send(
          new GetObjectCommand({ Bucket: S3_BUCKET, Key: poster.s3Key }),
        );
        const bytes = await obj.Body!.transformToByteArray();
        const buffer = Buffer.from(bytes);

        // Extract palette
        const palette = await extractColorPalette(buffer);

        // Update the media record
        await db
          .update(media)
          .set({ colorPalette: palette })
          .where(eq(media.id, poster.id));

        processed++;
      } catch (err) {
        failed++;
        errors.push(`${poster.id}: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    }

    return NextResponse.json({
      total: posters.length,
      processed,
      failed,
      errors: errors.slice(0, 10),
    });
  } catch (err) {
    console.error("Backfill failed:", err);
    return NextResponse.json(
      { error: "Backfill failed" },
      { status: 500 },
    );
  }
}
