import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { applyMonochromeProcessing } from "@/lib/s3/media";
import { monochromeParamsSchema } from "@/lib/validations/media";
import { isUuid } from "@/lib/utils/uuid";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import {
  buildDisplayFiles,
  commitDisplay,
  displayFraming,
  editorCrop,
  readS3Object,
} from "@/lib/media/display";

/**
 * POST /api/media/reprocess-author
 *
 * Re-process an author media item from its stored original with new
 * monochrome parameters. The original (color) image is never modified.
 * A saved crop is applied again to the new monochrome image.
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
    if (!isUuid(mediaId)) {
      return NextResponse.json({ error: "Invalid mediaId" }, { status: 400 });
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

    // Paintings keep originals too: only a person's image is made monochrome
    if (!record || !record.authorId || !record.originalS3Key) {
      return NextResponse.json(
        { error: "Author image not found or has no original to reprocess" },
        { status: 404 },
      );
    }

    const mono = await applyMonochromeProcessing(
      await readS3Object(record.originalS3Key),
      parsed.data,
    );
    const crop = editorCrop(record);
    const files = await buildDisplayFiles(record, crop, mono);
    const updated = await commitDisplay(record, files, {
      processingParams: parsed.data,
      ...displayFraming(crop),
    });
    if (!updated) {
      return NextResponse.json(
        { error: "This image changed while you edited it. Reload and try again." },
        { status: 409 },
      );
    }

    invalidate(CACHE_TAGS.works, CACHE_TAGS.media, CACHE_TAGS.authors);

    return NextResponse.json({ media: updated });
  } catch (err) {
    console.error("Author media reprocess failed:", err);
    return NextResponse.json(
      { error: "Reprocessing failed" },
      { status: 500 },
    );
  }
}
