/**
 * Cover colours for the covers stored before SLN-405, in batches:
 *
 * 1. Every stored palette without its named colour gets one (no download).
 * 2. Posters without a palette: the palette is read from the thumbnail.
 * 3. Edition covers without a palette: the same, from the cover thumbnail.
 *
 * Steps 2 and 3 download at most `limit` images per call, posters first, in
 * id order (no limit: every image, each tried once). A full batch answers
 * `next`; the next call passes it as `after` and starts past every image
 * the batch tried, those it could not read included. `next` is null when
 * nothing is left to try. `dryRun` only counts. Used by
 * `POST /api/media/backfill-palettes` and
 * `scripts/maintenance/backfill-cover-colors.ts`.
 */
import { and, asc, count, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { editions, media } from "@/lib/db/schema";
import { getS3Object } from "@/lib/s3/covers";
import type { ColorPalette } from "@/lib/types";
import { extractColorPalette } from "./extract-palette";
import { colorBucketOfPalette, editionCoverPaletteFields, mediaPaletteFields } from "./color-buckets";

export interface CoverColorBackfill {
  /** Stored palettes that got their colour */
  colored: number;
  posters: { processed: number; failed: number };
  covers: { processed: number; failed: number };
  /** Images still without a palette after this call */
  remaining: { posters: number; covers: number };
  /** At most 10, as "id: message" */
  errors: string[];
  /** Where the next batch starts ("poster:<id>", "cover:<id>"); null when this one tried the rest */
  next: string | null;
}

/** A batch's starting place: past this poster, or past every poster and this cover */
function readPlace(after: string | undefined): { kind: "poster" | "cover"; id: string } | null {
  const match = after?.match(/^(poster|cover):([0-9a-f-]{36})$/i);
  return match ? { kind: match[1].toLowerCase() as "poster" | "cover", id: match[2].toLowerCase() } : null;
}

const posterWithout = and(eq(media.type, "poster"), isNull(media.colorPalette));
const coverWithout = and(isNotNull(editions.thumbnailS3Key), isNull(editions.coverPalette));

async function paletteOf(key: string): Promise<ColorPalette> {
  const object = await getS3Object(key);
  if (!object.body) throw new Error("The image is empty");
  return extractColorPalette(Buffer.from(await object.body.transformToByteArray()));
}

export async function backfillCoverColors({
  limit = Infinity,
  dryRun = false,
  after,
}: { limit?: number; dryRun?: boolean; after?: string } = {}): Promise<CoverColorBackfill> {
  const place = readPlace(after);
  const result: CoverColorBackfill = {
    colored: 0,
    posters: { processed: 0, failed: 0 },
    covers: { processed: 0, failed: 0 },
    remaining: { posters: 0, covers: 0 },
    errors: [],
    next: null,
  };
  const fail = (id: string, error: unknown) => {
    if (result.errors.length < 10) result.errors.push(`${id}: ${error instanceof Error ? error.message : "unknown error"}`);
  };

  // 1. Palettes stored without their colour
  const uncoloredMedia = await db
    .select({ id: media.id, palette: media.colorPalette })
    .from(media)
    .where(and(isNotNull(media.colorPalette), isNull(media.colorBucket)));
  const uncoloredCovers = await db
    .select({ id: editions.id, palette: editions.coverPalette })
    .from(editions)
    .where(and(isNotNull(editions.coverPalette), isNull(editions.coverColorBucket)));
  for (const row of uncoloredMedia) {
    const bucket = colorBucketOfPalette(row.palette as ColorPalette);
    if (!bucket) continue;
    if (!dryRun) await db.update(media).set({ colorBucket: bucket }).where(eq(media.id, row.id));
    result.colored++;
  }
  for (const row of uncoloredCovers) {
    const bucket = colorBucketOfPalette(row.palette);
    if (!bucket) continue;
    if (!dryRun) await db.update(editions).set({ coverColorBucket: bucket }).where(eq(editions.id, row.id));
    result.colored++;
  }

  // 2. Posters without a palette
  const batch = Math.max(0, limit);
  const posters =
    dryRun || place?.kind === "cover"
      ? []
      : await db
          .select({ id: media.id, s3Key: media.s3Key, thumbnailS3Key: media.thumbnailS3Key })
          .from(media)
          .where(and(posterWithout, place ? gt(media.id, place.id) : undefined))
          .orderBy(asc(media.id))
          .limit(Number.isFinite(batch) ? batch : 100_000);
  for (const poster of posters) {
    try {
      const palette = await paletteOf(poster.thumbnailS3Key ?? poster.s3Key);
      await db.update(media).set(mediaPaletteFields(palette)).where(eq(media.id, poster.id));
      result.posters.processed++;
    } catch (error) {
      result.posters.failed++;
      fail(poster.id, error);
    }
  }

  // 3. Edition covers without a palette, with what is left of the batch
  const covers = dryRun
    ? []
    : await db
        .select({ id: editions.id, thumbnailS3Key: editions.thumbnailS3Key })
        .from(editions)
        .where(and(coverWithout, place?.kind === "cover" ? gt(editions.id, place.id) : undefined))
        .orderBy(asc(editions.id))
        .limit(Number.isFinite(batch) ? Math.max(0, batch - posters.length) : 100_000);
  for (const cover of covers) {
    try {
      const palette = await paletteOf(cover.thumbnailS3Key!);
      await db.update(editions).set(editionCoverPaletteFields(palette)).where(eq(editions.id, cover.id));
      result.covers.processed++;
    } catch (error) {
      result.covers.failed++;
      fail(cover.id, error);
    }
  }

  // A full batch may have left images behind: the next one starts past it
  if (posters.length + covers.length === batch && batch > 0)
    result.next = covers.length ? `cover:${covers.at(-1)!.id}` : `poster:${posters.at(-1)!.id}`;

  const [[postersLeft], [coversLeft]] = await Promise.all([
    db.select({ n: count() }).from(media).where(posterWithout),
    db.select({ n: count() }).from(editions).where(coverWithout),
  ]);
  result.remaining = { posters: postersLeft?.n ?? 0, covers: coversLeft?.n ?? 0 };
  return result;
}
