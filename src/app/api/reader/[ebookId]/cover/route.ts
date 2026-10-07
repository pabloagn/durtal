import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/utils/uuid";
import { ebookDerivedKey, isEbookCoverWidth } from "@/lib/ebooks/keys";
import { getEbookObjectRange } from "@/lib/ebooks/storage";
import { readCatalogueCover } from "@/lib/ebooks/delivery/files";
import { coverUrlFor, ebookDelivery } from "@/lib/ebooks/delivery/url";

/** Prevent Next.js from caching this route handler's response. */
export const dynamic = "force-dynamic";

const DAY_SECONDS = 86400;
const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/**
 * GET /api/reader/[ebookId]/cover?w=240|400|800 — an e-book's cover (its
 * preferred file's), at one width. With CloudFront, a 302 to the signed
 * cover; otherwise the app streams it from the e-book bucket. 400 without a
 * valid `w`, 404 for an e-book with no cover.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ ebookId: string }> }) {
  const { ebookId } = await params;
  if (!isUuid(ebookId)) return NextResponse.json({ error: "Invalid eBook id" }, { status: 400 });
  const w = req.nextUrl.searchParams.get("w");
  const width = w && /^\d+$/.test(w) ? Number(w) : NaN;
  if (!isEbookCoverWidth(width)) return NextResponse.json({ error: "w must be 240, 400 or 800" }, { status: 400 });
  try {
    const cover = await readCatalogueCover(ebookId.toLowerCase());
    if (!cover?.sha256) return notFound();
    if (ebookDelivery() === "cloudfront") {
      const signed = coverUrlFor(cover, width)!;
      // The redirect is kept no longer than its signature stays good, less an hour
      const left = Math.floor((signed.expiresAt!.getTime() - Date.now()) / 1000) - 3600;
      return new NextResponse(null, {
        status: 302,
        headers: { Location: signed.url, "Cache-Control": `private, max-age=${Math.max(0, Math.min(DAY_SECONDS, left))}` },
      });
    }
    const object = await getEbookObjectRange(ebookDerivedKey(cover.sha256, `cover-${width}.webp`), 0);
    if (!object) return notFound();
    return new NextResponse(object.body, {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(object.length),
        "Cache-Control": `private, max-age=${DAY_SECONDS}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[api/reader/cover] Failed to read cover:", err);
    return NextResponse.json({ error: "Failed to read cover" }, { status: 500 });
  }
}
