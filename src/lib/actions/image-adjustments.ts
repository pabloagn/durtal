"use server";

import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import {
  media,
  authors,
  editions,
  venues,
  collections,
  commentAttachments,
  calibreBooks,
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

async function resolveImage(source: string) {
  const identity = imageSourceIdentity(z.string().max(4096).parse(source));
  if (!identity) throw new Error("This image is not a stored Durtal asset");
  if ("calibreId" in identity) {
    const row = await db.query.calibreBooks.findFirst({
      where: eq(calibreBooks.calibreId, identity.calibreId),
    });
    if (!row?.coverS3Key) throw new Error("Image not found");
    return {
      assetKey: row.coverS3Key,
      sources: [
        s3ImageSource(row.coverS3Key),
        `/api/reader/${row.calibreId}/cover`,
      ],
      monochrome: false,
      media: null,
    };
  }
  const key = identity.key;
  const item = await db.query.media.findFirst({
    where: or(eq(media.s3Key, key), eq(media.thumbnailS3Key, key)),
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

  const [author, edition, venue, collection, attachment, calibre] =
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
      db.query.collections.findFirst({
        where: or(
          eq(collections.coverS3Key, key),
          eq(collections.posterS3Key, key),
          eq(collections.posterThumbnailS3Key, key),
          eq(collections.backgroundS3Key, key),
        ),
      }),
      db.query.commentAttachments.findFirst({
        where: and(
          eq(commentAttachments.s3Key, key),
          eq(commentAttachments.isImage, true),
        ),
        columns: { s3Key: true },
      }),
      db.query.calibreBooks.findFirst({
        where: eq(calibreBooks.coverS3Key, key),
        columns: { coverS3Key: true, calibreId: true },
      }),
    ]);
  let keys: (string | null)[];
  if (author) keys = [author.photoS3Key];
  else if (edition) keys = [edition.coverS3Key, edition.thumbnailS3Key];
  else if (venue) keys = [venue.posterS3Key, venue.thumbnailS3Key];
  else if (collection)
    keys =
      key === collection.backgroundS3Key
        ? [collection.backgroundS3Key]
        : key === collection.posterS3Key ||
            key === collection.posterThumbnailS3Key
          ? [collection.posterS3Key, collection.posterThumbnailS3Key]
          : [collection.coverS3Key];
  else if (attachment) keys = [attachment.s3Key];
  else if (calibre) keys = [calibre.coverS3Key];
  else throw new Error("Image not found");
  const validKeys = [...new Set(keys.filter((k): k is string => !!k))];
  const sources = validKeys.map(s3ImageSource);
  if (calibre) sources.push(`/api/reader/${calibre.calibreId}/cover`);
  return { assetKey: validKeys[0], sources, monochrome: !!author, media: null };
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
  return {
    assetKey: asset.assetKey,
    source: s3ImageSource(asset.assetKey),
    monochrome: asset.monochrome,
    settings: enforceImagePolicy(settings, asset.monochrome),
    crop:
      asset.media && asset.media.type !== "gallery"
        ? {
            cropX: asset.media.cropX,
            cropY: asset.media.cropY,
            cropZoom: asset.media.cropZoom,
          }
        : null,
    aspect:
      asset.media?.type === "poster"
        ? 2 / 3
        : asset.media?.type === "background"
          ? 16 / 9
          : null,
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
  if (data.crop && (!asset.media || asset.media.type === "gallery"))
    throw new Error("This image does not support framed cropping");
  const settings = enforceImagePolicy(data.settings, asset.monochrome);
  const record = {
    assetKey: asset.assetKey,
    sources: asset.sources,
    settings,
    monochrome: asset.monochrome,
    updatedAt: new Date(),
  };
  await atomic((d) => [
    d
      .insert(imageAdjustments)
      .values(record)
      .onConflictDoUpdate({ target: imageAdjustments.assetKey, set: record }),
    ...(asset.media
      ? [
          d
            .update(media)
            .set({
              ...data.crop,
              brightness: settings.brightness,
              contrast: settings.contrast,
            })
            .where(eq(media.id, asset.media.id)),
        ]
      : []),
  ]);
  invalidate(
    CACHE_TAGS.media,
    CACHE_TAGS.works,
    CACHE_TAGS.authors,
    CACHE_TAGS.collections,
    CACHE_TAGS.venues,
  );
  return record;
}
