import { NextRequest, NextResponse } from "next/server";
import { ingestMedia } from "@/lib/media/ingest";
import { ingestRefusal, parseAttribution, parseParams } from "@/lib/media/route-input";
import { isMediaEntityType, supportsMediaType } from "@/lib/media/owner";
import { isAllowedImageType, MAX_MEDIA_SIZE_BYTES } from "@/lib/validations/media-security";
import type { MediaEntityType } from "@/lib/s3/keys";
import type { MediaType } from "@/lib/types";
import { isUuid } from "@/lib/utils/uuid";

/**
 * POST /api/media/upload
 *
 * Accepts a multipart form upload. Processes the image server-side
 * and uploads to S3, bypassing CORS issues with presigned URLs.
 *
 * FormData fields:
 *   file: File (required)
 *   entityType: a media owner type (required)
 *   entityId: string (required)
 *   mediaType: "poster" | "background" | "gallery" (required)
 *   attribution: JSON alt text, credit, license and source (optional)
 *   processingParams: JSON monochrome settings, authors only (optional)
 */
export async function POST(req: NextRequest) {
  try {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      const requestId = crypto.randomUUID();
      // No storage or database operation has happened: this response is safe to retry.
      console.warn("[media/upload] Invalid multipart body", {
        requestId,
        contentLength: req.headers.get("content-length"),
        aborted: req.signal.aborted,
      });
      return NextResponse.json({
        code: "INVALID_MULTIPART",
        requestId,
        error: "The image did not arrive intact. Please drop it again or save it and choose the file.",
      }, { status: 400 });
    }
    const file = formData.get("file") as File | null;
    const entityType = formData.get("entityType") as MediaEntityType | null;
    const entityId = formData.get("entityId") as string | null;
    const mediaType = formData.get("mediaType") as MediaType | null;

    if (!file || !entityType || !entityId || !mediaType) {
      return NextResponse.json(
        { error: "Missing required fields: file, entityType, entityId, mediaType" },
        { status: 400 },
      );
    }

    if (!["poster", "background", "gallery"].includes(mediaType)) {
      return NextResponse.json({ error: "Invalid mediaType" }, { status: 400 });
    }

    if (!isMediaEntityType(entityType) || !supportsMediaType(entityType, mediaType)) {
      return NextResponse.json(
        { error: "This owner does not accept that image type" },
        { status: 400 },
      );
    }
    if (!isUuid(entityId)) {
      return NextResponse.json({ error: "Invalid entityId" }, { status: 400 });
    }

    if (file.size > MAX_MEDIA_SIZE_BYTES) {
      return NextResponse.json(
        { error: "File too large. Maximum size: 50 MB." },
        { status: 400 },
      );
    }

    if (!isAllowedImageType(file.type)) {
      return NextResponse.json(
        { error: "File type not allowed. Accepted: JPEG, PNG, WebP, GIF." },
        { status: 400 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    const media = await ingestMedia({
      owner: { type: entityType, id: entityId },
      mediaType,
      buffer,
      originalFilename: file.name,
      attribution: parseAttribution(formData.get("attribution")),
      processingParams: parseParams(formData.get("processingParams")),
    });
    return NextResponse.json({ media });
  } catch (err) {
    const refused = ingestRefusal(err);
    if (refused) return refused;
    console.error("Media upload failed:", err);
    return NextResponse.json(
      { error: "Media upload failed" },
      { status: 500 },
    );
  }
}
