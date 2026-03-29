import { NextRequest, NextResponse } from "next/server";
import { processAndUploadMedia, processAndUploadAuthorMedia } from "@/lib/s3/media";
import { createMedia, setActiveMedia } from "@/lib/actions/media";
import { updateCollection } from "@/lib/actions/collections";
import { monochromeParamsSchema, DEFAULT_MONOCHROME_PARAMS } from "@/lib/validations/media";
import type { MediaEntityType } from "@/lib/s3/keys";
import type { MediaType } from "@/lib/types";

/**
 * POST /api/media/from-url
 *
 * Downloads an image from a URL, processes it through the full media pipeline
 * (resize, WebP conversion, thumbnail generation), and creates a media record.
 *
 * Supports all entity types (work, author, collection) — same processing
 * as /api/media/upload, just with server-side download instead of client upload.
 *
 * Body: {
 *   entityType?: "work" | "author" | "collection" (default: "work")
 *   entityId?: string
 *   workId?: string              (legacy — use entityId instead)
 *   mediaType: "poster" | "background" | "gallery"
 *   imageUrl: string
 *   caption?: string
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      workId: legacyWorkId,
      entityType: rawEntityType,
      entityId: rawEntityId,
      mediaType,
      imageUrl,
      caption,
    } = body as {
      workId?: string;
      entityType?: MediaEntityType;
      entityId?: string;
      mediaType: MediaType;
      imageUrl: string;
      caption?: string;
    };

    // Support both new (entityType/entityId) and legacy (workId) interfaces
    const entityType: MediaEntityType = rawEntityType ?? "work";
    const entityId = rawEntityId ?? legacyWorkId;

    if (!entityId || !mediaType || !imageUrl) {
      return NextResponse.json(
        { error: "Missing required fields: entityId, mediaType, imageUrl" },
        { status: 400 },
      );
    }

    if (!["poster", "background", "gallery"].includes(mediaType)) {
      return NextResponse.json(
        { error: "Invalid mediaType" },
        { status: 400 },
      );
    }

    // Download the image from the URL
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Durtal/1.0; +https://durtal.app)",
        "Accept": "image/*,*/*;q=0.8",
      },
      redirect: "follow",
    });
    if (!response.ok) {
      console.error(`Image download failed: ${response.status} ${response.statusText} for ${imageUrl}`);
      return NextResponse.json(
        { error: `Failed to download image from URL (${response.status})` },
        { status: 400 },
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length === 0) {
      return NextResponse.json(
        { error: "Downloaded image is empty" },
        { status: 400 },
      );
    }

    const fileId = crypto.randomUUID();

    // Author media: monochrome pipeline with original preservation
    if (entityType === "author") {
      const rawParams = body.processingParams;
      let params = DEFAULT_MONOCHROME_PARAMS;
      if (rawParams) {
        const parsed = monochromeParamsSchema.safeParse(rawParams);
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
        mimeType: "image/webp",
        width: result.width,
        height: result.height,
        sizeBytes: buffer.length,
        processingParams: params,
        caption,
      });

      if (mediaType === "poster" || mediaType === "background") {
        await setActiveMedia(record.id);
      }

      return NextResponse.json({ media: record });
    }

    // Process and upload to S3
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
      ...(entityType === "work"
        ? { workId: entityId }
        : { authorId: entityId }),
      type: mediaType,
      s3Key: result.s3Key,
      thumbnailS3Key: result.thumbnailS3Key,
      mimeType: "image/webp",
      width: result.width,
      height: result.height,
      sizeBytes: buffer.length,
      caption,
    });

    // Activate the new record (deactivates others of same type+owner)
    if (mediaType === "poster" || mediaType === "background") {
      await setActiveMedia(record.id);
    }

    return NextResponse.json({ media: record });
  } catch (err) {
    console.error("Media from-url failed:", err);
    return NextResponse.json(
      { error: "Failed to process image from URL" },
      { status: 500 },
    );
  }
}
