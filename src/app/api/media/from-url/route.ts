import { NextRequest, NextResponse } from "next/server";
import { ingestMedia } from "@/lib/media/ingest";
import { ingestRefusal, parseAttribution, parseParams } from "@/lib/media/route-input";
import { isMediaEntityType, supportsMediaType } from "@/lib/media/owner";
import { safeFetchImage, SafeFetchError, type SafeFetchErrorCode } from "@/lib/net/safe-fetch";
import { isUuid } from "@/lib/utils/uuid";
import type { MediaEntityType } from "@/lib/s3/keys";
import type { MediaType } from "@/lib/types";

const FROM_URL_ERRORS: Partial<Record<SafeFetchErrorCode, string>> = {
  blocked_url: "URL not allowed. Only HTTPS URLs to public hosts are accepted.",
  blocked_address: "URL not allowed. The host resolves to a private or reserved address.",
  bad_status: "Failed to download image from URL.",
  too_large: "Downloaded image too large. Maximum size: 50 MB.",
  not_image: "The URL does not point to a JPEG, PNG, GIF or WebP image.",
  timeout: "The image download timed out.",
  too_many_redirects: "The URL redirects too many times.",
  network: "Failed to download image from URL.",
};

/**
 * POST /api/media/from-url
 *
 * Downloads an image from a URL, processes it through the full media pipeline
 * (resize, WebP conversion, thumbnail generation), and creates a media record.
 *
 * Supports every media owner type through the same ingest path as
 * /api/media/upload, with a server-side download instead of a client upload.
 * The download address is stored as the image's source.
 *
 * Body: {
 *   entityType?: a media owner type (default: "work")
 *   entityId?: string
 *   workId?: string              (legacy — use entityId instead)
 *   mediaType: "poster" | "background" | "gallery"
 *   imageUrl: string
 *   caption?: string
 *   attribution?: alt text, credit, license and source
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
    if (!isMediaEntityType(entityType) || !supportsMediaType(entityType, mediaType)) {
      return NextResponse.json(
        { error: "This owner does not accept that image type" },
        { status: 400 },
      );
    }
    if (!isUuid(entityId)) {
      return NextResponse.json({ error: "Invalid entityId" }, { status: 400 });
    }

    // Download through the SSRF, redirect, size, timeout and image-type guard
    let buffer: Buffer;
    try {
      ({ buffer } = await safeFetchImage(imageUrl));
    } catch (err) {
      if (err instanceof SafeFetchError) {
        console.warn(`Image download refused (${err.code}): ${err.message}`);
        return NextResponse.json(
          { error: FROM_URL_ERRORS[err.code] ?? err.message },
          { status: 400 },
        );
      }
      throw err;
    }

    const attribution = parseAttribution(body.attribution) ?? {};
    const media = await ingestMedia({
      owner: { type: entityType, id: entityId },
      mediaType,
      buffer,
      caption: caption ?? null,
      // The download address is the image's source unless one was given.
      attribution: { sourceUrl: imageUrl, ...attribution },
      processingParams: parseParams(body.processingParams),
    });
    return NextResponse.json({ media });
  } catch (err) {
    const refused = ingestRefusal(err);
    if (refused) return refused;
    console.error("Media from-url failed:", err);
    return NextResponse.json(
      { error: "Failed to process image from URL" },
      { status: 500 },
    );
  }
}
