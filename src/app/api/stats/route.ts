import { NextResponse } from "next/server";
import { getLibraryStats } from "@/lib/actions/works";
import { readingApiStats } from "@/lib/reading/api-stats";

/** The library's numbers, and since SLN-458 its reading: open readings, the year's numbers and goals */
export async function GET() {
  try {
    const [stats, reading] = await Promise.all([getLibraryStats(), readingApiStats()]);
    return NextResponse.json({ ...stats, reading });
  } catch (err) {
    console.error("[api/stats] Failed to fetch stats:", err);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
