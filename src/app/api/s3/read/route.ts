import { NextRequest, NextResponse } from "next/server";
import { getPresignedReadUrl } from "@/lib/s3/covers";

/**
 * GET /api/s3/read?key=...
 * Redirects to a pre-signed S3 URL for reading an object.
 */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  try {
    const url = await getPresignedReadUrl(key, 3600);
    return NextResponse.redirect(url);
  } catch {
    return NextResponse.json({ error: "Failed to get URL" }, { status: 500 });
  }
}
