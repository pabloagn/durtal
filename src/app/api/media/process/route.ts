import { NextRequest, NextResponse } from "next/server";
import { processAndUploadMedia } from "@/lib/s3/media";
import { createMedia } from "@/lib/actions/media";
import { bronzeMediaKey } from "@/lib/s3/keys";
import { getPresignedUploadUrl } from "@/lib/s3/covers";
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
        entityType: "work" | "author";
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
      entityType: "work" | "author";
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

    // Process and upload to gold/
    const result = await processAndUploadMedia(
      entityType,
      entityId,
      mediaType,
      fileId,
      buffer,
    );

    // Create DB record
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

    return NextResponse.json({ media: record });
  } catch (err) {
    console.error("Media processing failed:", err);
    return NextResponse.json(
      { error: "Media processing failed" },
      { status: 500 },
    );
  }
}
