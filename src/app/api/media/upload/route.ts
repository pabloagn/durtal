import { NextRequest, NextResponse } from "next/server";
import { processAndUploadMedia, processAndUploadAuthorMedia } from "@/lib/s3/media";
import { createMedia, setActiveMedia } from "@/lib/actions/media";
import { updateCollection } from "@/lib/actions/collections";
import { monochromeParamsSchema, DEFAULT_MONOCHROME_PARAMS } from "@/lib/validations/media";
import type { MediaEntityType } from "@/lib/s3/keys";
import type { MediaType } from "@/lib/types";

/**
 * POST /api/media/upload
 *
 * Accepts a multipart form upload. Processes the image server-side
 * and uploads to S3, bypassing CORS issues with presigned URLs.
 *
 * FormData fields:
 *   file: File (required)
 *   entityType: "work" | "author" | "collection" (required)
 *   entityId: string (required)
 *   mediaType: "poster" | "background" | "gallery" (required)
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
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

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    const fileId = crypto.randomUUID();

    // Author media: monochrome pipeline with original preservation
    if (entityType === "author") {
      const rawParams = formData.get("processingParams") as string | null;
      let params = DEFAULT_MONOCHROME_PARAMS;
      if (rawParams) {
        const parsed = monochromeParamsSchema.safeParse(JSON.parse(rawParams));
        if (parsed.success) params = parsed.data;
      }

      const result = await processAndUploadAuthorMedia(
        entityId, mediaType, fileId, buffer, params,
      );

      const record = await createMedia({
        authorId: entityId,
        type: mediaType,
        s3Key: result.s3Key,
        thumbnailS3Key: result.thumbnailS3Key,
        originalS3Key: result.originalS3Key,
        originalFilename: file.name,
        mimeType: "image/webp",
        width: result.width,
        height: result.height,
        sizeBytes: file.size,
        processingParams: params,
      });

      if (mediaType === "poster" || mediaType === "background") {
        await setActiveMedia(record.id);
      }

      return NextResponse.json({ media: record });
    }

    // Process and upload to gold/
    const result = await processAndUploadMedia(
      entityType,
      entityId,
      mediaType,
      fileId,
      buffer,
    );

    // For collections, store S3 keys directly on the collection record
    if (entityType === "collection") {
      const updateData: Record<string, string | null> = {};
      if (mediaType === "poster") {
        updateData.posterS3Key = result.s3Key;
        updateData.posterThumbnailS3Key = result.thumbnailS3Key;
      } else if (mediaType === "background") {
        updateData.backgroundS3Key = result.s3Key;
      }
      await updateCollection(entityId, updateData);
      return NextResponse.json({
        s3Key: result.s3Key,
        thumbnailS3Key: result.thumbnailS3Key,
        width: result.width,
        height: result.height,
      });
    }

    // For works/authors, create a media DB record
    const record = await createMedia({
      ...(entityType === "work" ? { workId: entityId } : { authorId: entityId }),
      type: mediaType,
      s3Key: result.s3Key,
      thumbnailS3Key: result.thumbnailS3Key,
      originalFilename: file.name,
      mimeType: "image/webp",
      width: result.width,
      height: result.height,
      sizeBytes: file.size,
    });

    // Activate the new record (deactivates others of same type+owner)
    if (mediaType === "poster" || mediaType === "background") {
      await setActiveMedia(record.id);
    }

    return NextResponse.json({ media: record });
  } catch (err) {
    console.error("Media upload failed:", err);
    return NextResponse.json(
      { error: "Media upload failed" },
      { status: 500 },
    );
  }
}
