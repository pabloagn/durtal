import { NextRequest, NextResponse } from "next/server";
import { searchGoogleBooks } from "@/lib/api/google-books";
import { searchOpenLibrary } from "@/lib/api/open-library";
import type { SearchResult } from "@/lib/api/types";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const query = searchParams.get("q");
  const source = searchParams.get("source") ?? "all";

  if (!query) {
    return NextResponse.json(
      { error: "Provide ?q= parameter" },
      { status: 400 },
    );
  }

  const validSources = ["all", "google_books", "open_library"];
  if (!validSources.includes(source)) {
    return NextResponse.json(
      { error: "Invalid source. Use: all, google_books, open_library" },
      { status: 400 },
    );
  }

  try {
    const searches: Promise<SearchResult[]>[] = [];

    if (source === "all" || source === "google_books") {
      searches.push(
        searchGoogleBooks(query, 10).catch(() => [] as SearchResult[]),
      );
    }

    if (source === "all" || source === "open_library") {
      searches.push(
        searchOpenLibrary(query, 10).catch(() => [] as SearchResult[]),
      );
    }

    const resultArrays = await Promise.all(searches);
    const results = resultArrays.flat();

    // Normalize to the compact shape the dialog expects
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
