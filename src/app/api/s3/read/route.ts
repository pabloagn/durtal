import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3, S3_BUCKET } from "@/lib/s3/client";
import { isMediaWidth } from "@/lib/s3/media-url";
import { contentHeaders, isReadableKey, READ_SAFETY_HEADERS } from "@/lib/s3/read-headers";
import { bodyBytes } from "@/lib/s3/read-object";

/** Prevent Next.js from caching this route handler's response. */
export const dynamic = "force-dynamic";

/** Versioned URLs (`v`) change when the bytes change, so the browser keeps them. */
const IMMUTABLE = "public, max-age=31536000, immutable";
/** Unversioned URLs may point at bytes that change: revalidate with the ETag. */
const REVALIDATE = "private, no-cache";

/** Map S3's ETag to the one for this variant, so each width has its own. */
function variantEtag(s3Etag: string, width: number | null) {
  if (!width) return s3Etag;
  return `"${s3Etag.replace(/"/g, "")}-w${width}"`;
}

/** The S3 ETag that a browser's If-None-Match refers to, if any. */
function s3EtagFrom(ifNoneMatch: string | null, width: number | null) {
  if (!ifNoneMatch) return undefined;
  if (!width) return ifNoneMatch;
  const suffix = `-w${width}"`;
  return ifNoneMatch.endsWith(suffix)
    ? `${ifNoneMatch.slice(0, -suffix.length)}"`
    : undefined;
}

/**
 * GET /api/s3/read?key=...[&w=400][&v=...]
 *
 * Streams the S3 object: an image, a cover or a comment attachment
 * (`isReadableKey`); any other key is refused. With `w`, resizes it to that
 * width (allowed widths only). With `v`, marks the response immutable. Only raster images
 * show inline; see `contentHeaders`.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const key = params.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }
  if (!isReadableKey(key)) {
    return NextResponse.json({ error: "This file cannot be read" }, { status: 400 });
  }

  const wParam = params.get("w");
  const width = wParam ? Number(wParam) : null;
  if (width !== null && !isMediaWidth(width)) {
    return NextResponse.json({ error: "Unsupported width" }, { status: 400 });
  }

  const cacheControl = params.has("v") ? IMMUTABLE : REVALIDATE;
  const ifNoneMatch = req.headers.get("if-none-match");

  try {
    const obj = await s3.send(
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        IfNoneMatch: s3EtagFrom(ifNoneMatch, width),
      }),
    );

    const headers: Record<string, string> = {
      "Cache-Control": cacheControl,
      ...contentHeaders(obj.ContentType),
    };
    if (obj.ETag) headers.ETag = variantEtag(obj.ETag, width);

    if (width) {
      const sharp = (await import("sharp")).default;
      const input = await bodyBytes(obj.Body, key);
      const { width: sourceWidth = 0 } = await sharp(input).metadata();
      // Already that narrow: send the stored bytes, not a second compression
      if (sourceWidth <= width) {
        return new NextResponse(new Uint8Array(input), { headers });
      }
      const output = await sharp(input)
        .resize({ width })
        .webp({ quality: 75 })
        .toBuffer();
      return new NextResponse(new Uint8Array(output), {
        headers: { ...headers, ...contentHeaders("image/webp") },
      });
    }

    if (obj.ContentLength != null) headers["Content-Length"] = String(obj.ContentLength);
    return new NextResponse(obj.Body!.transformToWebStream(), { headers });
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    if (status === 304 && ifNoneMatch) {
      return new NextResponse(null, {
        status: 304,
        headers: { ...READ_SAFETY_HEADERS, "Cache-Control": cacheControl, ETag: ifNoneMatch },
      });
    }
    if (status === 404 || (err as { name?: string }).name === "NoSuchKey") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("[api/s3/read] Failed to read object:", err);
    return NextResponse.json({ error: "Failed to read object" }, { status: 500 });
  }
}
