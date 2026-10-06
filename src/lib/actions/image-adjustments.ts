"use server";

import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  media,
  authors,
  editions,
  venues,
  commentAttachments,
  imageAdjustments,
} from "@/lib/db/schema";
import { cached, invalidate, CACHE_TAGS } from "@/lib/cache";
import {
  imageSourceIdentity,
  s3ImageSource,
  imageAdjustmentsSchema,
  enforceImagePolicy,
  type StoredImageAdjustments,
} from "@/lib/utils/image-adjustments";
import { updateMediaCropSchema } from "@/lib/validations/media";
import { mediaFrameAspect } from "@/lib/media/crop";
import {
  buildDisplayFiles,
  commitDisplay,
  displayFraming,
  editorCrop,
} from "@/lib/media/display";

/** The stored image behind an editor source. E-book covers have no adjustments. */
async function resolveImage(source: string): Promise<{
  assetKey: string;
  sources: string[];
  monochrome: boolean;
  media: typeof media.$inferSelect | null;
}> {
  const identity = imageSourceIdentity(z.string().max(4096).parse(source));
  if (!identity) throw new Error("This image is not a stored Durtal asset");
  const key = identity.key;
  // The uncropped key also resolves, so an editor opened before a crop still saves
  const item = await db.query.media.findFirst({
    where: or(
      eq(media.s3Key, key),
      eq(media.thumbnailS3Key, key),
      eq(media.uncroppedS3Key, key),
    ),
  });
  if (item)
    return {
      assetKey: item.s3Key,
      sources: [item.s3Key, item.thumbnailS3Key]
        .filter((k): k is string => !!k)
        .map(s3ImageSource),
      monochrome: !!item.authorId,
      media: item,
    };

  // Collection posters and backgrounds are media rows, resolved above.
  const [author, edition, venue, attachment] =
    await Promise.all([
      db.query.authors.findFirst({
        where: eq(authors.photoS3Key, key),
        columns: { photoS3Key: true },
      }),
      db.query.editions.findFirst({
        where: or(
          eq(editions.coverS3Key, key),
          eq(editions.thumbnailS3Key, key),
        ),
        columns: { coverS3Key: true, thumbnailS3Key: true },
      }),
      db.query.venues.findFirst({
        where: or(eq(venues.posterS3Key, key), eq(venues.thumbnailS3Key, key)),
        columns: { posterS3Key: true, thumbnailS3Key: true },
      }),
      db.query.commentAttachments.findFirst({
        where: and(
          eq(commentAttachments.s3Key, key),
          eq(commentAttachments.isImage, true),
        ),
        columns: { s3Key: true },
      }),
    ]);
  let keys: (string | null)[];
  if (author) keys = [author.photoS3Key];
  else if (edition) keys = [edition.coverS3Key, edition.thumbnailS3Key];
  else if (venue) keys = [venue.posterS3Key, venue.thumbnailS3Key];
  else if (attachment) keys = [attachment.s3Key];
  else throw new Error("Image not found");
  const validKeys = [...new Set(keys.filter((k): k is string => !!k))];
  return {
    assetKey: validKeys[0],
    sources: validKeys.map(s3ImageSource),
    monochrome: !!author,
    media: null,
  };
}

const getStored = cached(
  async () => db.select().from(imageAdjustments),
  ["image-adjustments"],
  [CACHE_TAGS.media],
);
export async function getImageAdjustmentStyles(): Promise<
  StoredImageAdjustments[]
> {
  return getStored();
}

export async function getImagePresentation(source: string) {
  const asset = await resolveImage(source);
  const [stored] = await db
    .select()
    .from(imageAdjustments)
    .where(eq(imageAdjustments.assetKey, asset.assetKey));
  const settings = imageAdjustmentsSchema.parse(
    stored?.settings ?? {
      brightness: asset.media?.brightness ?? 100,
      contrast: asset.media?.contrast ?? 100,
    },
  );
  const framed = asset.media && mediaFrameAspect(asset.media.type) ? asset.media : null;
  const crop = framed ? editorCrop(framed) : null;
  return {
    assetKey: asset.assetKey,
    source: s3ImageSource(asset.assetKey),
    // The editor crops the uncropped image; every other view shows the crop
    preview: s3ImageSource(framed?.uncroppedS3Key ?? asset.assetKey),
    monochrome: asset.monochrome,
    settings: enforceImagePolicy(settings, asset.monochrome),
    crop: crop
      ? { cropX: crop.x, cropY: crop.y, cropZoom: crop.zoom }
      : null,
    aspect: framed ? mediaFrameAspect(framed.type) : null,
  };
}

const presentationSchema = z
  .object({
    settings: imageAdjustmentsSchema,
    crop: updateMediaCropSchema
      .pick({ cropX: true, cropY: true, cropZoom: true })
      .optional(),
  })
  .strict();

export async function saveImagePresentation(
  source: string,
  input: z.input<typeof presentationSchema>,
): Promise<StoredImageAdjustments> {
  const data = presentationSchema.parse(input);
  const asset = await resolveImage(source);
  const item = asset.media;
  if (data.crop && (!item || !mediaFrameAspect(item.type)))
    throw new Error("This image does not support framed cropping");
  const settings = enforceImagePolicy(data.settings, asset.monochrome);

  if (!item) {
    const record = {
      assetKey: asset.assetKey,
      sources: asset.sources,
      settings,
      monochrome: asset.monochrome,
      updatedAt: new Date(),
    };
    await db
      .insert(imageAdjustments)
      .values(record)
      .onConflictDoUpdate({ target: imageAdjustments.assetKey, set: record });
    invalidateImages();
    return record;
  }

  // A crop is written into new files. The uncropped image is never modified.
  const crop = data.crop && {
    x: data.crop.cropX,
    y: data.crop.cropY,
    zoom: data.crop.cropZoom,
  };
  const files = crop ? await buildDisplayFiles(item, crop) : null;
  const updated = await commitDisplay(
    item,
    files,
    {
      brightness: settings.brightness,
      contrast: settings.contrast,
      ...(crop && displayFraming(crop)),
    },
    { settings, monochrome: asset.monochrome },
  );
  if (!updated)
    throw new Error("This image changed while you edited it. Reload and try again.");
  invalidateImages();
  return {
    assetKey: updated.s3Key,
    sources: [updated.s3Key, updated.thumbnailS3Key]
      .filter((k): k is string => !!k)
      .map(s3ImageSource),
    settings,
    monochrome: asset.monochrome,
  };
}

function invalidateImages() {
  invalidate(
    CACHE_TAGS.media,
    CACHE_TAGS.works,
    CACHE_TAGS.authors,
    CACHE_TAGS.collections,
    CACHE_TAGS.venues,
  );
}
