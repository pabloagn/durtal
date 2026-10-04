import { NextResponse } from "next/server";
import { getLibraryStats } from "@/lib/actions/works";

export async function GET() {
  try {
    const stats = await getLibraryStats();
    return NextResponse.json(stats);
  } catch (err) {
    console.error("[api/stats] Failed to fetch stats:", err);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
