import { NextRequest, NextResponse } from "next/server";
import { getCalibreBookById } from "@/lib/calibre/queries";
import { getS3Object } from "@/lib/s3/covers";

const CONTENT_TYPES: Record<string, string> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  mobi: "application/x-mobipocket-ebook",
  azw3: "application/x-mobi8-ebook",
};

/** Format priority when none is specified */
const FORMAT_PRIORITY = ["epub", "pdf", "mobi", "azw3"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ calibreId: string }> },
) {
  const { calibreId } = await params;
  const id = parseInt(calibreId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid calibre ID" }, { status: 400 });
  }

  const book = await getCalibreBookById(id);
  if (!book || !book.formats?.length) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  // Select format: honor query param or use priority
  const requestedFormat = req.nextUrl.searchParams.get("format")?.toLowerCase();
  let selectedFormat = book.formats.find(
    (f) => f.format.toLowerCase() === requestedFormat,
  );

  if (!selectedFormat) {
    for (const pref of FORMAT_PRIORITY) {
      selectedFormat = book.formats.find(
        (f) => f.format.toLowerCase() === pref,
      );
      if (selectedFormat) break;
    }
  }

  if (!selectedFormat) {
    selectedFormat = book.formats[0];
  }

  if (!selectedFormat.s3Key) {
    return NextResponse.json(
      { error: "File not available (no S3 key)" },
      { status: 404 },
    );
  }

  try {
    // Stream bytes from S3 — avoids CORS issues with epub.js fetch
    const s3Obj = await getS3Object(selectedFormat.s3Key);
    if (!s3Obj.body) {
      return NextResponse.json({ error: "File not found in S3" }, { status: 404 });
    }

    const ext = selectedFormat.format.toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? s3Obj.contentType ?? "application/octet-stream";
    const sanitizedTitle = book.title.replace(/[^a-zA-Z0-9_\-. ]/g, "_");

    // AWS SDK returns a web-compatible ReadableStream
    const webStream = s3Obj.body.transformToWebStream();

    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        ...(s3Obj.contentLength ? { "Content-Length": s3Obj.contentLength.toString() } : {}),
        "Content-Disposition": `inline; filename="${sanitizedTitle}.${ext}"`,
        "Cache-Control": "private, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch file from S3" },
      { status: 500 },
    );
  }
}
