/**
 * Display files of poster and background media: the image every view of
 * the app shows, with the crop in the file itself.
 *
 * Rules that keep this safe:
 * - The uncropped image (`uncroppedS3Key`, or `s3Key` before the first crop)
 *   and the author color original (`originalS3Key`) are never modified.
 * - Each new version is written to fresh keys. No stored object is
 *   overwritten, so a failed step leaves the current version untouched.
 * - Replaced files are deleted only after the database points at the new
 *   ones, and only when no row uses them (`deleteUnusedObjects`).
 */
import { and, eq, sql } from "drizzle-orm";
import { atomic } from "@/lib/db/atomic";
import { media } from "@/lib/db/schema";
import { uploadToS3 } from "@/lib/s3/covers";
import { readS3Object } from "@/lib/s3/read-object";
import { goldMediaVersionKeys } from "@/lib/s3/keys";
import { deleteUnusedObjects } from "@/lib/s3/cleanup";
import type { MediaType } from "@/lib/types";
import { mediaOwnerKind } from "./ingest";
import { mediaOwnerOf } from "./owner";
import { imagePolicy } from "./policy";
import {
  s3ImageSource,
  type ImageAdjustments,
} from "@/lib/utils/image-adjustments";
import {
  cropRegion,
  isNoCrop,
  mediaFrameAspect,
  NO_CROP,
  sameCrop,
  type AppliedCrop,
} from "./crop";

type MediaRow = typeof media.$inferSelect;

export interface DisplayFiles {
  s3Key: string;
  thumbnailS3Key: string;
  uncroppedS3Key: string | null;
  appliedCrop: AppliedCrop | null;
  width: number;
  height: number;
  /** Objects this build wrote. Discard them when the database write fails. */
  created: string[];
}

/** The crop that the row's display files show now. */
export function displayedCrop(row: MediaRow): AppliedCrop | null {
  return row.uncroppedS3Key ? row.appliedCrop : null;
}

/** The crop the editor starts from: the applied crop, else the legacy CSS framing. */
export function editorCrop(row: MediaRow): AppliedCrop {
  return row.appliedCrop ?? { x: row.cropX, y: row.cropY, zoom: row.cropZoom };
}

/**
 * Point the row at new display files (if any) and write `set`, in one
 * transaction, only when the row is unchanged since it was read. Display
 * settings follow the image to its new key; `settings` replaces them.
 * Then delete the replaced files. Returns null when the row changed: the new
 * files are discarded and nothing is written.
 */
export async function commitDisplay(
  row: MediaRow,
  files: DisplayFiles | null,
  set: Partial<typeof media.$inferInsert>,
  settings?: { settings: ImageAdjustments; monochrome: boolean },
): Promise<MediaRow | null> {
  const assetKey = files?.s3Key ?? row.s3Key;
  const sources = [assetKey, files ? files.thumbnailS3Key : row.thumbnailS3Key]
    .filter((key): key is string => !!key)
    .map(s3ImageSource);
  // Written only when the media row now shows `assetKey`
  const shown = sql`exists (select 1 from media where id = ${row.id} and s3_key = ${assetKey})`;
  const onConflict = sql`on conflict (asset_key) do update set
    sources = excluded.sources, settings = excluded.settings,
    monochrome = excluded.monochrome, updated_at = excluded.updated_at`;

  let results: unknown[];
  try {
    results = await atomic((d) => [
      d
        .update(media)
        .set({
          ...set,
          ...(files && {
            s3Key: files.s3Key,
            thumbnailS3Key: files.thumbnailS3Key,
            uncroppedS3Key: files.uncroppedS3Key,
            appliedCrop: files.appliedCrop,
            width: files.width,
            height: files.height,
          }),
        })
        .where(and(eq(media.id, row.id), eq(media.s3Key, row.s3Key)))
        .returning(),
      settings
        ? d.execute(sql`
            insert into image_adjustments (asset_key, sources, settings, monochrome, updated_at)
            select ${assetKey}, ${JSON.stringify(sources)}::jsonb,
              ${JSON.stringify(settings.settings)}::jsonb, ${settings.monochrome}, now()
            where ${shown} ${onConflict}`)
        : d.execute(sql`
            insert into image_adjustments (asset_key, sources, settings, monochrome, updated_at)
            select ${assetKey}, ${JSON.stringify(sources)}::jsonb, settings, monochrome, now()
            from image_adjustments
            where asset_key = ${row.s3Key} and ${shown} ${onConflict}`),
    ]);
  } catch (err) {
    if (files) await removeS3Keys(files.created);
    throw err;
  }
  const [updated] = results[0] as MediaRow[];
  if (!updated) {
    if (files) await removeS3Keys(files.created);
    return null;
  }
  if (files) await removeS3Keys(replacedKeys(row, files));
  return updated;
}

/** Keys the row used before that the new files no longer use. */
function replacedKeys(row: MediaRow, files: DisplayFiles): string[] {
  const kept = new Set(
    [files.s3Key, files.thumbnailS3Key, files.uncroppedS3Key, row.originalS3Key].filter(
      (key): key is string => !!key,
    ),
  );
  return [row.s3Key, row.thumbnailS3Key, row.uncroppedS3Key].filter(
    (key): key is string => !!key && !kept.has(key),
  );
}

/** Remove files no row uses. A failure is logged and only leaves orphans. */
async function removeS3Keys(keys: string[]): Promise<void> {
  await deleteUnusedObjects({ keys, prefixes: [] }, "replaced media files");
}

/**
 * The CSS framing to store with display files built for `crop`: its focal
 * point and no zoom. Views of another shape keep showing the chosen part,
 * and object-position only moves the image inside its own file, so no view
 * shows what the crop cut away.
 */
export function displayFraming(crop: AppliedCrop) {
  return { cropX: crop.x, cropY: crop.y, cropZoom: NO_CROP.zoom };
}

/**
 * Write display files that show `crop`. Reads the stored uncropped image, or
 * uses `uncropped` (a new uncropped image, e.g. after monochrome tuning).
 * Returns null when the current files already show this crop.
 */
export async function buildDisplayFiles(
  row: MediaRow,
  crop: AppliedCrop,
  uncropped?: Buffer,
): Promise<DisplayFiles | null> {
  const aspect = mediaFrameAspect(row.type);
  const asked = isNoCrop(crop) ? null : { x: crop.x, y: crop.y, zoom: crop.zoom };
  if (asked && !aspect) throw new Error("This image does not support framed cropping");
  // Sizes follow the owner's image policy; a contained image is never cut.
  const owner = mediaOwnerOf(row);
  const policy = imagePolicy(
    { type: owner.type, kind: await mediaOwnerKind(owner) },
    row.type as MediaType,
  );
  if (asked && policy.fit === "contain")
    throw new Error("This image is always shown whole and cannot be cropped");
  if (!uncropped && sameCrop(displayedCrop(row), asked)) return null;

  const sharp = (await import("sharp")).default;
  const source = uncropped
    ? await sharp(uncropped).webp({ quality: 90 }).toBuffer()
    : await readS3Object(row.uncroppedS3Key ?? row.s3Key);
  const meta = await sharp(source).metadata();
  const turned = (meta.orientation ?? 1) >= 5;
  const width = (turned ? meta.height : meta.width) ?? 0;
  const height = (turned ? meta.width : meta.height) ?? 0;
  if (!width || !height) throw new Error("Could not read the image size");
  // A crop that keeps the whole image cuts nothing: no cropped file
  const region = asked && aspect ? cropRegion(width, height, aspect, asked) : null;
  const cut = region && (region.width < width || region.height < height) ? region : null;
  if (!uncropped && !cut && !row.uncroppedS3Key) return null;

  const keys = goldMediaVersionKeys(owner.type, owner.id, row.type, row.id, version());
  const created: string[] = [];
  const put = async (key: string, body: Buffer) => {
    await uploadToS3(key, body, "image/webp");
    created.push(key);
  };

  try {
    let uncroppedKey = row.uncroppedS3Key ?? row.s3Key;
    if (uncropped) {
      uncroppedKey = cut ? keys.uncropped : keys.full;
      await put(uncroppedKey, source);
    }
    const framed = () => {
      const image = sharp(source).rotate();
      return cut ? image.extract(cut) : image;
    };

    await put(
      keys.thumbnail,
      await framed()
        .resize(policy.thumbWidth, policy.thumbHeight, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer(),
    );
    if (!cut)
      return {
        s3Key: uncroppedKey,
        thumbnailS3Key: keys.thumbnail,
        uncroppedS3Key: null,
        appliedCrop: null,
        width,
        height,
        created,
      };

    const full = await framed()
      .resize(policy.maxWidth, policy.maxHeight, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    await put(keys.full, full.data);
    return {
      s3Key: keys.full,
      thumbnailS3Key: keys.thumbnail,
      uncroppedS3Key: uncroppedKey,
      appliedCrop: asked,
      width: full.info.width,
      height: full.info.height,
      created,
    };
  } catch (err) {
    await removeS3Keys(created);
    throw err;
  }
}



function version(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
