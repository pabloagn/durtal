import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { s3, S3_BUCKET } from "@/lib/s3/client";
import { isMediaWidth } from "@/lib/s3/media-url";

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
 * Streams the S3 object. With `w`, resizes it to that width (allowed
 * widths only). With `v`, marks the response immutable.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const key = params.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
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
      "Content-Disposition": "inline",
    };
    if (obj.ETag) headers.ETag = variantEtag(obj.ETag, width);

    if (width) {
      const sharp = (await import("sharp")).default;
      const input = Buffer.from(await obj.Body!.transformToByteArray());
      const { width: sourceWidth = 0 } = await sharp(input).metadata();
      // Already that narrow: send the stored bytes, not a second compression
      if (sourceWidth <= width) {
        if (obj.ContentType) headers["Content-Type"] = obj.ContentType;
        return new NextResponse(new Uint8Array(input), { headers });
      }
      const output = await sharp(input)
        .resize({ width })
        .webp({ quality: 75 })
        .toBuffer();
      return new NextResponse(new Uint8Array(output), {
        headers: { ...headers, "Content-Type": "image/webp" },
      });
    }

    if (obj.ContentType) headers["Content-Type"] = obj.ContentType;
    if (obj.ContentLength != null) headers["Content-Length"] = String(obj.ContentLength);
    return new NextResponse(obj.Body!.transformToWebStream(), { headers });
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    if (status === 304 && ifNoneMatch) {
      return new NextResponse(null, {
        status: 304,
        headers: { "Cache-Control": cacheControl, ETag: ifNoneMatch },
      });
    }
    if (status === 404 || (err as { name?: string }).name === "NoSuchKey") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to read object" }, { status: 500 });
  }
}
