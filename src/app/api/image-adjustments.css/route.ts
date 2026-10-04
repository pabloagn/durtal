import type { NextRequest } from "next/server";
import { getImageAdjustmentStyles } from "@/lib/actions/image-adjustments";
import { getImageAdjustmentsVersion } from "@/lib/media/adjustment-stylesheet";
import { imageAdjustmentStyles } from "@/lib/utils/image-adjustments";

/** Saved photo adjustments as one stylesheet. The root layout links it with the current version. */
export async function GET(request: NextRequest) {
  const [rows, version] = await Promise.all([
    getImageAdjustmentStyles(),
    getImageAdjustmentsVersion(),
  ]);
  // Only the current version is cached for good; any other URL is served fresh
  const current = request.nextUrl.searchParams.get("v") === version;
  return new Response(imageAdjustmentStyles(rows), {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": current
        ? "public, max-age=31536000, immutable"
        : "no-store",
    },
  });
}
