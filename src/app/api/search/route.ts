import { NextRequest, NextResponse } from "next/server";
import { searchBooks } from "@/lib/api/search-engine";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const query = searchParams.get("q");
  const isbn = searchParams.get("isbn");

  if (!query && !isbn) {
    return NextResponse.json(
      { error: "Provide ?q= or ?isbn= parameter" },
      { status: 400 },
    );
  }

  try {
    const searchQuery = isbn ? isbn : query!;
    const results = await searchBooks(searchQuery);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 },
    );
  }
}
