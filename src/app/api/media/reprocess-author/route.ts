import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { reprocessAuthorMedia } from "@/lib/s3/media";
import { monochromeParamsSchema } from "@/lib/validations/media";
import { invalidate, CACHE_TAGS } from "@/lib/cache";

/**
 * POST /api/media/reprocess-author
 *
 * Re-process an author media item from its stored original with new
 * monochrome parameters. The original (color) image is never modified.
 *
 * Body: { mediaId: string, processingParams: MonochromeParams }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { mediaId, processingParams: rawParams } = body as {
      mediaId: string;
      processingParams: unknown;
    };

    if (!mediaId) {
      return NextResponse.json({ error: "Missing mediaId" }, { status: 400 });
    }

    const parsed = monochromeParamsSchema.safeParse(rawParams);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid processing params", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const record = await db.query.media.findFirst({
      where: eq(media.id, mediaId),
    });

    if (!record || !record.originalS3Key) {
      return NextResponse.json(
        { error: "Media item not found or has no original to reprocess" },
        { status: 404 },
      );
    }

    const { width, height } = await reprocessAuthorMedia(
      {
        s3Key: record.s3Key,
        thumbnailS3Key: record.thumbnailS3Key,
        originalS3Key: record.originalS3Key,
      },
      parsed.data,
    );

    // Update DB record with new params and dimensions
    const [updated] = await db
      .update(media)
      .set({
        processingParams: parsed.data,
        width,
        height,
      })
      .where(eq(media.id, mediaId))
      .returning();

    invalidate(CACHE_TAGS.works, CACHE_TAGS.media);

    return NextResponse.json({ media: updated });
  } catch (err) {
    console.error("Author media reprocess failed:", err);
    return NextResponse.json(
      { error: "Reprocessing failed" },
      { status: 500 },
    );
  }
}
