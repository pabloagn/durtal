import { NextRequest, NextResponse } from "next/server";
import { getAuthor } from "@/lib/actions/authors";
import { isUuid } from "@/lib/utils/uuid";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }
    const author = await getAuthor(id);
    if (!author) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(author);
  } catch (err) {
    console.error("[api/authors/:id] Failed to fetch author:", err);
    return NextResponse.json({ error: "Failed to fetch author" }, { status: 500 });
  }
}
