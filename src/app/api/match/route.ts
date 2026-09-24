import { NextRequest, NextResponse } from "next/server";
import { searchBooks } from "@/lib/api/search-engine";

const VALID_SOURCES = ["all", "isbndb", "google_books", "open_library"] as const;

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const query = searchParams.get("q")?.trim() || null;
  const source = searchParams.get("source") ?? "all";

  if (!query) {
    return NextResponse.json(
      { error: "Provide ?q= parameter" },
      { status: 400 },
    );
  }

  try {
    let results = await searchBooks(query);

    // Post-filter by source if not "all"
    if (source !== "all" && VALID_SOURCES.includes(source as (typeof VALID_SOURCES)[number])) {
      results = results.filter((r) => r.source === source);
    }

    const normalized = results.map((r) => ({
      id: `${r.source}:${r.sourceId}`,
      title: r.title,
      subtitle: r.subtitle,
      authors: r.authors,
      year: r.publicationYear,
      isbn: r.isbn13 ?? r.isbn10,
      coverUrl: r.coverUrl,
      source: r.source,
      sourceId: r.sourceId,
      publisher: r.publisher,
      pageCount: r.pageCount,
      language: r.language,
    }));

    return NextResponse.json({ results: normalized });
  } catch {
    return NextResponse.json(
      { error: "Match search failed" },
      { status: 500 },
    );
  }
}
