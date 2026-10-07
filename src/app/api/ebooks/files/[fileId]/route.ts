import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/utils/uuid";
import { contentTypeFor } from "@/lib/ebooks/formats";
import { getEbookObjectRange, headEbookObject } from "@/lib/ebooks/storage";
import { isDeliverable, readCatalogueFile, type CatalogueFile } from "@/lib/ebooks/delivery/files";
import { etagMatches, parseRange } from "@/lib/ebooks/delivery/range";

/** Prevent Next.js from caching this route handler's response. */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ fileId: string }> };

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/** The headers of every answer: the URL names the file, and a file's bytes never change */
function fileHeaders(file: CatalogueFile): Record<string, string> {
  return {
    "Accept-Ranges": "bytes",
    ETag: `"${file.sha256}"`,
    "Cache-Control": "private, max-age=31536000, immutable",
    // The type of its format, never one a row could hold otherwise (no HTML or SVG)
    "Content-Type": contentTypeFor(file.format),
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
  };
}

/** The file a request names, or the answer that refuses it */
async function deliverable(params: Params["params"]): Promise<CatalogueFile | NextResponse> {
  const { fileId } = await params;
  // A malformed id is refused before any database or S3 call
  if (!isUuid(fileId)) return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
  const file = await readCatalogueFile(fileId.toLowerCase());
  // Quarantined, missing, replaced and DRM files are not served
  if (!file || !isDeliverable(file)) return notFound();
  return file;
}

/**
 * GET /api/ebooks/files/[fileId] — one stored e-book file, from the e-book
 * bucket (or a preview's folder): the app's own delivery, for development,
 * previews and when CloudFront is not set up. Answers one byte range with
 * 206, none with 200, an unsatisfiable one with 416, and the file's ETag
 * with 304. Streams; nothing is buffered.
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const file = await deliverable(params);
    if (file instanceof NextResponse) return file;
    const headers = fileHeaders(file);
    if (etagMatches(req.headers.get("if-none-match"), headers.ETag)) {
      return new NextResponse(null, { status: 304, headers });
    }
    const size = file.sizeBytes;
    const range = parseRange(req.headers.get("range"), size);
    if (range.kind === "unsatisfiable") {
      return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }
    if (size === 0) {
      return (await headEbookObject(file.s3Key))
        ? new NextResponse(null, { status: 200, headers: { ...headers, "Content-Length": "0" } })
        : notFound();
    }
    const [start, end] = range.kind === "partial" ? [range.start, range.end] : [0, size - 1];
    const object = await getEbookObjectRange(file.s3Key, start, end);
    if (!object) return notFound();
    if (range.kind === "whole") {
      return new NextResponse(object.body, { status: 200, headers: { ...headers, "Content-Length": String(object.length) } });
    }
    return new NextResponse(object.body, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${start + object.length - 1}/${size}`,
        "Content-Length": String(object.length),
      },
    });
  } catch (err) {
    console.error("[api/ebooks/files] Failed to read file:", err);
    return NextResponse.json({ error: "Failed to read file" }, { status: 500 });
  }
}

/** HEAD /api/ebooks/files/[fileId] — the same headers, no body */
export async function HEAD(req: NextRequest, { params }: Params) {
  try {
    const file = await deliverable(params);
    if (file instanceof NextResponse) return new NextResponse(null, { status: file.status });
    const headers = fileHeaders(file);
    if (etagMatches(req.headers.get("if-none-match"), headers.ETag)) {
      return new NextResponse(null, { status: 304, headers });
    }
    if (!(await headEbookObject(file.s3Key))) return new NextResponse(null, { status: 404 });
    return new NextResponse(null, { status: 200, headers: { ...headers, "Content-Length": String(file.sizeBytes) } });
  } catch (err) {
    console.error("[api/ebooks/files] Failed to read file:", err);
    return new NextResponse(null, { status: 500 });
  }
}
