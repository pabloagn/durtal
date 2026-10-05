import { NextResponse } from "next/server";
import { requireAdminToken } from "@/lib/api/admin";
import { backfillCoverColors } from "@/lib/color/backfill";

/**
 * POST /api/media/backfill-palettes?limit=50&after=…&dryRun=1
 *
 * Palettes and cover colours for posters and edition covers stored without
 * them (SLN-405, `backfillCoverColors`): at most `limit` images per call (1
 * to 500, default 50), posters first. Call again with `after` set to the
 * answer's `next` until `next` is null; images that could not be read are
 * passed, not retried. `dryRun=1` only counts.
 */
export async function POST(req: Request) {
  const denied = requireAdminToken(req);
  if (denied) return denied;

  const params = new URL(req.url).searchParams;
  const raw = Number(params.get("limit") ?? 50);
  const limit = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), 500) : 50;
  const dryRun = ["1", "true"].includes(params.get("dryRun") ?? "");
  try {
    return NextResponse.json(await backfillCoverColors({ limit, dryRun, after: params.get("after") ?? undefined }));
  } catch (err) {
    console.error("Backfill failed:", err);
    return NextResponse.json({ error: "Backfill failed" }, { status: 500 });
  }
}
