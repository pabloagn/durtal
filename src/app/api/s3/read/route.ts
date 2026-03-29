import { NextRequest, NextResponse } from "next/server";
import { getPresignedReadUrl } from "@/lib/s3/covers";

/**
 * In-memory cache for presigned S3 URLs.
 * Presigned URLs are valid for 1 hour; we cache for 30 minutes to leave
 * a wide safety margin. This eliminates redundant signing operations
 * without risking expired URLs reaching the browser.
 */
const urlCache = new Map<string, { url: string; expiresAt: number }>();
const PRESIGN_TTL = 3600; // 1 hour
const CACHE_TTL = 1800 * 1000; // 30 minutes in ms

function getCachedUrl(key: string): string | null {
  const entry = urlCache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.url;
  urlCache.delete(key);
  return null;
}

function setCachedUrl(key: string, url: string) {
  urlCache.set(key, { url, expiresAt: Date.now() + CACHE_TTL });
  if (urlCache.size > 2000) {
    const now = Date.now();
    for (const [k, v] of urlCache) {
      if (now >= v.expiresAt) urlCache.delete(k);
    }
  }
}

/** Prevent Next.js from caching this route handler's response. */
export const dynamic = "force-dynamic";

/**
 * GET /api/s3/read?key=...
 *
 * Redirects to a presigned S3 URL. The in-memory cache avoids
 * re-signing on every request. No browser-side redirect caching —
 * presigned URLs are ephemeral and must not be cached downstream.
 */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  try {
    let url = getCachedUrl(key);
    if (!url) {
      url = await getPresignedReadUrl(key, PRESIGN_TTL);
      setCachedUrl(key, url);
    }

    return NextResponse.redirect(url);
  } catch {
    return NextResponse.json({ error: "Failed to get URL" }, { status: 500 });
  }
}
