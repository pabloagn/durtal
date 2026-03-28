import { NextRequest, NextResponse } from "next/server";
import { searchGoogleBooks, searchGoogleBooksByIsbn } from "@/lib/api/google-books";
import { searchOpenLibrary, searchOpenLibraryByIsbn } from "@/lib/api/open-library";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const query = searchParams.get("q");
  const isbn = searchParams.get("isbn");
  const source = searchParams.get("source"); // "google" | "openlibrary" | null (both)

  if (!query && !isbn) {
    return NextResponse.json(
      { error: "Provide ?q= or ?isbn= parameter" },
      { status: 400 },
    );
  }

  try {
    if (isbn) {
      // ISBN lookup — query both sources in parallel
      const [google, openLib] = await Promise.all([
        source !== "openlibrary"
          ? searchGoogleBooksByIsbn(isbn)
          : Promise.resolve(null),
        source !== "google"
          ? searchOpenLibraryByIsbn(isbn)
          : Promise.resolve(null),
      ]);

      return NextResponse.json({
        results: [google, openLib].filter(Boolean),
      });
    }

    // Free-text search
    const [googleResults, openLibResults] = await Promise.all([
      source !== "openlibrary"
        ? searchGoogleBooks(query!, 5)
        : Promise.resolve([]),
      source !== "google"
        ? searchOpenLibrary(query!, 5)
        : Promise.resolve([]),
    ]);

    return NextResponse.json({
      results: [...googleResults, ...openLibResults],
    });
  } catch {
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 },
    );
  }
}
