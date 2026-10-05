import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getWorks, getWorkCount } from "@/lib/actions/works";
import { errorResponse } from "@/lib/api/rest";
import { API_SORTS, parseReadingFilters } from "@/lib/reading/filter-params";

/**
 * The book list. Besides `q`, `limit` and `offset`: `reading`, `readFrom`,
 * `readTo`, `reread`, `holding`, `status` and `sort` (title, recent, year,
 * rating, lastRead), through the library's parser (SLN-449). An unknown value
 * answers 400 with the issues. Each work carries its `reading`.
 */
export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const search = url.searchParams.get("q") ?? undefined;
    const { filters, sort, issues } = parseReadingFilters(url.searchParams, { sorts: API_SORTS });
    if (issues.length) throw new z.ZodError(issues);
    const limit = Math.max(1, Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200));
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);

    const [rows, total] = await Promise.all([
      getWorks({ search, sort: sort ?? "recent", limit, offset, filters }),
      getWorkCount(search, filters),
    ]);
    const works = rows.map(({ readingState, readingPercent, timesRead, lastFinishedOn, lastFinishedPrecision, ...work }) => ({
      ...work,
      reading: { state: readingState, timesRead, lastFinishedOn, lastFinishedPrecision, percent: readingPercent ?? null },
    }));

    return NextResponse.json({ works, total });
  } catch (err) {
    return errorResponse(err, "Failed to fetch works");
  }
}
