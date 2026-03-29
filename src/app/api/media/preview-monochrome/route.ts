import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { s3, S3_BUCKET } from "@/lib/s3/client";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { applyMonochromeProcessing } from "@/lib/s3/media";
import { monochromeParamsSchema } from "@/lib/validations/media";

/**
 * GET /api/media/preview-monochrome?mediaId=...&contrast=...&sharpness=...&gamma=...&brightness=...
 *
 * Ephemeral preview: fetches the original from S3, applies monochrome processing
 * at thumbnail resolution, and streams the result back. No S3 writes.
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const mediaId = sp.get("mediaId");

    if (!mediaId) {
      return NextResponse.json({ error: "Missing mediaId" }, { status: 400 });
    }

    const record = await db.query.media.findFirst({
      where: eq(media.id, mediaId),
    });

    if (!record || !record.originalS3Key) {
      return NextResponse.json(
        { error: "Media item not found or has no original" },
        { status: 404 },
      );
    }

    const params = monochromeParamsSchema.parse({
      grayscale: true,
      contrast: parseFloat(sp.get("contrast") ?? "1.0"),
      sharpness: parseFloat(sp.get("sharpness") ?? "1.0"),
      gamma: parseFloat(sp.get("gamma") ?? "2.2"),
      brightness: parseFloat(sp.get("brightness") ?? "1.0"),
    });

    // Fetch original from S3
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: record.originalS3Key }),
    );
    const bytes = await obj.Body!.transformToByteArray();
    const originalBuffer = Buffer.from(bytes);

    // Resize to thumbnail first for speed, then apply monochrome
    const sharp = (await import("sharp")).default;
    const resized = await sharp(originalBuffer)
      .resize(800, 1200, { fit: "inside", withoutEnlargement: true })
      .toBuffer();

    const processed = await applyMonochromeProcessing(resized, params);
    const output = await sharp(processed).webp({ quality: 82 }).toBuffer();

    return new NextResponse(new Uint8Array(output), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Monochrome preview failed:", err);
    return NextResponse.json(
      { error: "Preview generation failed" },
      { status: 500 },
    );
  }
}
