import { NextRequest, NextResponse } from "next/server";
import { processAndUploadMedia, processAndUploadAuthorMedia } from "@/lib/s3/media";
import { createMedia, setActiveMedia } from "@/lib/actions/media";
import { updateCollection } from "@/lib/actions/collections";
import { bronzeMediaKey, type MediaEntityType } from "@/lib/s3/keys";
import { getPresignedUploadUrl } from "@/lib/s3/covers";
import { monochromeParamsSchema, DEFAULT_MONOCHROME_PARAMS } from "@/lib/validations/media";
import type { MediaType } from "@/lib/types";

/**
 * POST /api/media/process
 *
 * Two modes:
 * 1. `action: "presign"` — returns a pre-signed URL for the client to PUT the raw image to bronze/
 * 2. `action: "process"` — processes a raw image already in bronze/ into gold/ and creates the DB record
 *
 * For direct upload from the web UI, the client:
 *   a) Calls with action=presign to get the upload URL + bronzeKey
 *   b) PUTs the file to S3 via the pre-signed URL
 *   c) Calls with action=process + bronzeKey to trigger processing
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    if (action === "presign") {
      const { entityType, entityId, filename, contentType } = body as {
        entityType: MediaEntityType;
        entityId: string;
        filename: string;
        contentType: string;
        action: string;
      };

      if (!entityType || !entityId || !filename || !contentType) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      const fileId = crypto.randomUUID();
      const ext = filename.split(".").pop() ?? "jpg";
      const key = bronzeMediaKey(entityType, entityId, fileId, ext);
      const url = await getPresignedUploadUrl(key, contentType);

      return NextResponse.json({ url, bronzeKey: key, fileId });
    }

    // action === "process" (default)
    const {
      entityType,
      entityId,
      mediaType,
      fileId,
      bronzeKey,
      originalFilename,
      mimeType,
      sizeBytes,
    } = body as {
      entityType: MediaEntityType;
      entityId: string;
      mediaType: MediaType;
      fileId: string;
      bronzeKey: string;
      originalFilename?: string;
      mimeType?: string;
      sizeBytes?: number;
    };

    if (!entityType || !entityId || !mediaType || !fileId || !bronzeKey) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Fetch the raw image from S3
    const { S3_BUCKET } = await import("@/lib/s3/client");
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { s3 } = await import("@/lib/s3/client");

    const obj = await s3.send(
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: bronzeKey }),
    );
    const bytes = await obj.Body!.transformToByteArray();
    const buffer = Buffer.from(bytes);

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
        originalFilename,
        mimeType: "image/webp",
        width: result.width,
        height: result.height,
        sizeBytes,
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
      originalFilename,
      mimeType: "image/webp",
      width: result.width,
      height: result.height,
      sizeBytes,
    });

    // Activate the new record (deactivates others of same type+owner)
    if (mediaType === "poster" || mediaType === "background") {
      await setActiveMedia(record.id);
    }

    return NextResponse.json({ media: record });
  } catch (err) {
    console.error("Media processing failed:", err);
    return NextResponse.json(
      { error: "Media processing failed" },
      { status: 500 },
    );
  }
}
