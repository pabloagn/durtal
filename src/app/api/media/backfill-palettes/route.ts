import { NextResponse } from "next/server";
import { requireAdminToken } from "@/lib/api/admin";
import { backfillCoverColors } from "@/lib/color/backfill";

/**
 * POST /api/media/backfill-palettes?limit=50
 *
 * Palettes and cover colours for posters and edition covers stored without
 * them (SLN-405, `backfillCoverColors`): at most `limit` images per call (1
 * to 500, default 50), posters first. Call again while `remaining` drops.
 */
export async function POST(req: Request) {
  const denied = requireAdminToken(req);
  if (denied) return denied;

  const raw = Number(new URL(req.url).searchParams.get("limit") ?? 50);
  const limit = Number.isInteger(raw) ? Math.min(Math.max(raw, 1), 500) : 50;
  try {
    return NextResponse.json(await backfillCoverColors({ limit }));
  } catch (err) {
    console.error("Backfill failed:", err);
    return NextResponse.json({ error: "Backfill failed" }, { status: 500 });
  }
}
