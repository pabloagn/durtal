import { NextRequest, NextResponse } from "next/server";
import { getAuthors, getAuthorCount } from "@/lib/actions/authors";

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const search = url.searchParams.get("q") ?? undefined;
    const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

    const [authors, total] = await Promise.all([
      getAuthors({ search, limit, offset }),
      getAuthorCount(search),
    ]);

    return NextResponse.json({ authors, total });
  } catch {
    return NextResponse.json({ error: "Failed to fetch authors" }, { status: 500 });
  }
}
