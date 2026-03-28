import { NextRequest, NextResponse } from "next/server";
import { getAuthor } from "@/lib/actions/authors";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const author = await getAuthor(id);
    if (!author) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(author);
  } catch {
    return NextResponse.json({ error: "Failed to fetch author" }, { status: 500 });
  }
}
