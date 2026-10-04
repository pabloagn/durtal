import { NextRequest, NextResponse } from "next/server";
import { requireAdminToken } from "@/lib/api/admin";
import { and, eq, inArray, isNull, or, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { NO_CROP } from "@/lib/media/crop";
import {
  buildDisplayFiles,
  commitDisplay,
  displayFraming,
  editorCrop,
} from "@/lib/media/display";

/**
 * POST /api/media/apply-crops[?dryRun=1][&id=<media id>]
 *
 * One-time move of crops saved as CSS framing (crop_x / crop_y / crop_zoom)
 * into real cropped files, so every view shows them. The uncropped image
 * stays at `uncropped_s3_key`. Safe to run again: rows already moved are
 * skipped. `dryRun=1` lists the rows and changes nothing. `id` limits the
 * run to one media item, to check it before the rest.
 */
export async function POST(req: NextRequest) {
  const denied = requireAdminToken(req);
  if (denied) return denied;
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  const id = req.nextUrl.searchParams.get("id");
  if (id && !z.string().uuid().safeParse(id).success)
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  // Not yet moved, with framing that can cut: a zoom, or a focal point that
  // picks part of an image of another shape. Framing that cuts nothing keeps
  // its focal point, needs no file and counts as unchanged.
  const rows = await db.query.media.findMany({
    where: and(
      inArray(media.type, ["poster", "background"]),
      isNull(media.uncroppedS3Key),
      id ? eq(media.id, id) : undefined,
      or(
        ne(media.cropX, NO_CROP.x),
        ne(media.cropY, NO_CROP.y),
        ne(media.cropZoom, NO_CROP.zoom),
      ),
    ),
  });
  if (dryRun)
    return NextResponse.json({
      dryRun: true,
      total: rows.length,
      rows: rows.map((row) => ({ id: row.id, type: row.type, s3Key: row.s3Key, crop: editorCrop(row) })),
    });

  let applied = 0;
  let unchanged = 0;
  const failed: { id: string; error: string }[] = [];
  for (const row of rows) {
    try {
      const crop = editorCrop(row);
      const files = await buildDisplayFiles(row, crop);
      const updated = await commitDisplay(row, files, displayFraming(crop));
      if (!updated) throw new Error("The row changed during the run");
      if (files) applied++;
      else unchanged++;
    } catch (err) {
      failed.push({ id: row.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  invalidate(CACHE_TAGS.media, CACHE_TAGS.works, CACHE_TAGS.authors, CACHE_TAGS.collections);
  return NextResponse.json({ total: rows.length, applied, unchanged, failed });
}
