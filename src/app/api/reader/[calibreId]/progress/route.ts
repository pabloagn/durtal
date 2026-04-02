import { NextRequest, NextResponse } from "next/server";
import {
  getCalibreBookById,
  getReadingProgress,
  upsertReadingProgress,
} from "@/lib/calibre/queries";

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
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  const progress = await getReadingProgress(book.id);
  return NextResponse.json({ progress });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ calibreId: string }> },
) {
  const { calibreId } = await params;
  const id = parseInt(calibreId, 10);
  if (isNaN(id)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const book = await getCalibreBookById(id);
  if (!book) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const cfi = typeof b.cfi === "string" ? b.cfi.slice(0, 2000) : undefined;
  const page = typeof b.page === "number" ? Math.max(0, Math.round(b.page)) : undefined;
  const progressPercent =
    typeof b.progressPercent === "number"
      ? Math.min(1, Math.max(0, b.progressPercent))
      : undefined;
  const currentChapter =
    typeof b.currentChapter === "string" ? b.currentChapter.slice(0, 500) : undefined;

  await upsertReadingProgress({
    calibreBookId: book.id,
    currentCfi: cfi,
    currentPage: page,
    progressPercent,
    currentChapter,
  });

  return NextResponse.json({ ok: true });
}
