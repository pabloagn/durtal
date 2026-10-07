import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/utils/uuid";
import { isDeliverable, readCatalogueFile } from "@/lib/ebooks/delivery/files";
import { fileUrlFor } from "@/lib/ebooks/delivery/url";

/** Prevent Next.js from caching this route handler's response. */
export const dynamic = "force-dynamic";

/**
 * GET /api/ebooks/files/[fileId]/url — where the browser reads one file:
 * `{ url, expiresAt }`, a signed CloudFront URL (or the app's own route,
 * which does not expire: `expiresAt` null). For a reader whose URL expired
 * while a book stayed open for hours. Same-origin only (src/proxy.ts); 404
 * for an unknown, quarantined, missing, replaced or DRM file.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  if (!isUuid(fileId)) return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
  try {
    const file = await readCatalogueFile(fileId.toLowerCase());
    if (!file || !isDeliverable(file)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { url, expiresAt } = fileUrlFor(file);
    return NextResponse.json(
      { url, expiresAt: expiresAt?.toISOString() ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/ebooks/files/url] Failed to sign:", err);
    return NextResponse.json({ error: "Failed to make the file's URL" }, { status: 500 });
  }
}
