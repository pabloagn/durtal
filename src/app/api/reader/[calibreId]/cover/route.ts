import { NextRequest, NextResponse } from "next/server";
import { getCalibreBookById } from "@/lib/calibre/queries";
import { getS3Object } from "@/lib/s3/covers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ calibreId: string }> },
) {
  const { calibreId } = await params;
  const id = parseInt(calibreId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const book = await getCalibreBookById(id);
  if (!book || !book.coverS3Key) {
    return NextResponse.json({ error: "No cover" }, { status: 404 });
  }

  try {
    const s3Obj = await getS3Object(book.coverS3Key);
    if (!s3Obj.body) {
      return NextResponse.json({ error: "Cover not found in S3" }, { status: 404 });
    }

    const webStream = s3Obj.body.transformToWebStream();

    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": s3Obj.contentType ?? "image/jpeg",
        ...(s3Obj.contentLength ? { "Content-Length": s3Obj.contentLength.toString() } : {}),
        "Cache-Control": "private, max-age=604800",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch cover from S3" },
      { status: 500 },
    );
  }
}
