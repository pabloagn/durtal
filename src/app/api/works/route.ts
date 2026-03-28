import { NextRequest, NextResponse } from "next/server";
import { getWorks, getWorkCount } from "@/lib/actions/works";

export async function GET(req: NextRequest) {
  try {
    const url = req.nextUrl;
    const search = url.searchParams.get("q") ?? undefined;
    const sort = (url.searchParams.get("sort") ?? "recent") as
      | "title"
      | "recent"
      | "year"
      | "rating";
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const offset = parseInt(url.searchParams.get("offset") ?? "0", 10);

    const [works, total] = await Promise.all([
      getWorks({ search, sort, limit, offset }),
      getWorkCount(search),
    ]);

    return NextResponse.json({ works, total });
  } catch {
    return NextResponse.json({ error: "Failed to fetch works" }, { status: 500 });
  }
}
