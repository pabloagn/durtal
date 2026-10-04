import { NextRequest, NextResponse } from "next/server";
import { ingestMedia, mediaOwnerKind } from "@/lib/media/ingest";
import { ingestRefusal, parseAttribution, parseParams } from "@/lib/media/route-input";
import { isMediaEntityType, supportsMediaType } from "@/lib/media/owner";
import { bronzeMediaKey, type MediaEntityType } from "@/lib/s3/keys";
import { getPresignedUploadUrl } from "@/lib/s3/covers";
import { isAllowedImageType } from "@/lib/validations/media-security";
import type { MediaType } from "@/lib/types";
import { isUuid } from "@/lib/utils/uuid";

/** The raw file's extension, from its checked type (never from the client's file name) */
const RAW_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * POST /api/media/process
 *
 * Two modes:
 * 1. `action: "presign"` — returns a pre-signed URL for the client to PUT the raw image to bronze/
 * 2. `action: "process"` — processes a raw image already in bronze/ into gold/ and creates the DB record
 *
 * The owner must exist before a URL is signed, and processing reads only the
 * raw file that presign named for this owner and file id: no other key.
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

      if (!isMediaEntityType(entityType)) {
        return NextResponse.json({ error: "Invalid entity type" }, { status: 400 });
      }
      if (!isUuid(entityId)) {
        return NextResponse.json({ error: "Invalid entityId" }, { status: 400 });
      }

      if (!isAllowedImageType(contentType)) {
        return NextResponse.json(
          { error: "File type not allowed. Accepted: JPEG, PNG, WebP, GIF." },
          { status: 400 },
        );
      }

      // A missing owner is refused (404) before anything can be uploaded
      await mediaOwnerKind({ type: entityType, id: entityId });
      const fileId = crypto.randomUUID();
      const ext = RAW_EXTENSIONS[contentType.toLowerCase().split(";")[0].trim()];
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
    } = body as {
      entityType: MediaEntityType;
      entityId: string;
      mediaType: MediaType;
      fileId: string;
      bronzeKey: string;
      originalFilename?: string;
    };

    if (!entityType || !entityId || !mediaType || !fileId || !bronzeKey) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
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
    if (!isUuid(entityId) || !isUuid(fileId)) {
      return NextResponse.json({ error: "Invalid entityId or fileId" }, { status: 400 });
    }
    // Only the raw file presign named for this owner and file id
    if (
      !Object.values(RAW_EXTENSIONS).some(
        (ext) => bronzeKey === bronzeMediaKey(entityType, entityId, fileId, ext),
      )
    ) {
      return NextResponse.json(
        { error: "This upload key does not belong to this image" },
        { status: 400 },
      );
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

    const media = await ingestMedia({
      owner: { type: entityType, id: entityId },
      mediaType,
      buffer,
      fileId,
      originalFilename: originalFilename ?? null,
      attribution: parseAttribution(body.attribution),
      processingParams: parseParams(body.processingParams),
    });
    return NextResponse.json({ media });
  } catch (err) {
    const refused = ingestRefusal(err);
    if (refused) return refused;
    console.error("Media processing failed:", err);
    return NextResponse.json(
      { error: "Media processing failed" },
      { status: 500 },
    );
  }
}
