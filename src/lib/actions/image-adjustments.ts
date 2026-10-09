"use server";

import { and, eq, or, sql } from "drizzle-orm";
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
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { resultRows } from "@/lib/harmonization/store";
import { fingerprintSchema } from "@/lib/validations/records";
import { mediaOwnerOf } from "@/lib/media/owner";
import { mediaOwnerKind } from "@/lib/media/ingest";
import { imagePolicy } from "@/lib/media/policy";
import { imageEditorPolicy } from "@/lib/media/editor-policy";
import { sameCrop } from "@/lib/media/crop";
import type { MediaType } from "@/lib/types";
import {
  assertImageRevision,
  imagePresentationLocks,
  imageRevisionExtras,
  imageRevisionSql,
  STALE_IMAGE_PRESENTATION,
  type ImageSubject,
} from "@/lib/media/presentation-revision";
import {
  buildDisplayFiles,
  commitDisplay,
  displayFraming,
  editorCrop,
  displayedCrop,
} from "@/lib/media/display";

/** Only exhausted registered-source lookup, never a database/validation failure. */
class MissingImageError extends Error {
  constructor(readonly key: string) {
    super("Image not found");
  }
}

/** The stored image behind an editor source. E-book covers have no adjustments. */
async function resolveImage(source: string): Promise<{
  assetKey: string;
  sources: string[];
  monochrome: boolean;
  media: typeof media.$inferSelect | null;
  subject: ImageSubject;
  revision: string;
  storedSettings: unknown;
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
    extras: imageRevisionExtras("media"),
  });
  if (item)
    return {
      assetKey: item.s3Key,
      sources: [item.s3Key, item.thumbnailS3Key]
        .filter((k): k is string => !!k)
        .map(s3ImageSource),
      monochrome: !!item.authorId,
      media: item,
      subject: { kind: "media", id: item.id },
      revision: item.revision,
      storedSettings: item.storedSettings,
    };

  // Collection posters and backgrounds are media rows, resolved above.
  const [author, edition, venue, attachment] = await Promise.all([
    db.query.authors.findFirst({
      where: eq(authors.photoS3Key, key),
      columns: { id: true, photoS3Key: true },
      extras: imageRevisionExtras("author"),
    }),
    db.query.editions.findFirst({
      where: or(eq(editions.coverS3Key, key), eq(editions.thumbnailS3Key, key)),
      columns: { id: true, coverS3Key: true, thumbnailS3Key: true },
      extras: imageRevisionExtras("edition"),
    }),
    db.query.venues.findFirst({
      where: or(eq(venues.posterS3Key, key), eq(venues.thumbnailS3Key, key)),
      columns: { id: true, posterS3Key: true, thumbnailS3Key: true },
      extras: imageRevisionExtras("venue"),
    }),
    db.query.commentAttachments.findFirst({
      where: and(
        eq(commentAttachments.s3Key, key),
        eq(commentAttachments.isImage, true),
      ),
      columns: { id: true, s3Key: true },
      extras: imageRevisionExtras("attachment"),
    }),
  ]);
  let keys: (string | null)[];
  if (author) keys = [author.photoS3Key];
  else if (edition) keys = [edition.coverS3Key, edition.thumbnailS3Key];
  else if (venue) keys = [venue.posterS3Key, venue.thumbnailS3Key];
  else if (attachment) keys = [attachment.s3Key];
  else throw new MissingImageError(key);
  const validKeys = [...new Set(keys.filter((k): k is string => !!k))];
  const found = author ?? edition ?? venue ?? attachment!;
  return {
    assetKey: validKeys[0],
    sources: validKeys.map(s3ImageSource),
    monochrome: !!author,
    media: null,
    subject: {
      kind: author
        ? "author"
        : edition
          ? "edition"
          : venue
            ? "venue"
            : "attachment",
      id: found.id,
    },
    revision: found.revision,
    storedSettings: found.storedSettings,
  };
}

async function editorPolicy(item: typeof media.$inferSelect) {
  const owner = mediaOwnerOf(item);
  return imageEditorPolicy(
    imagePolicy(
      { type: owner.type, kind: await mediaOwnerKind(owner) },
      item.type as MediaType,
    ),
    item.type,
    item,
  );
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
  const settings = imageAdjustmentsSchema.parse(
    asset.storedSettings ?? {
      brightness: asset.media?.brightness ?? 100,
      contrast: asset.media?.contrast ?? 100,
    },
  );
  const policy = asset.media ? await editorPolicy(asset.media) : null;
  const framed = policy?.supportsCrop ? asset.media : null;
  const crop = framed ? editorCrop(framed) : null;
  return {
    assetKey: asset.assetKey,
    source: s3ImageSource(asset.assetKey),
    revision: asset.revision,
    // The editor crops the uncropped image; every other view shows the crop
    preview: s3ImageSource(framed?.uncroppedS3Key ?? asset.assetKey),
    // Actual stored pixels and crop provenance, separate from the editor's base.
    display: s3ImageSource(asset.assetKey),
    appliedCrop: framed ? displayedCrop(framed) : null,
    supportsCrop: policy?.supportsCrop ?? false,
    fit: policy?.fit ?? "contain",
    monochrome: asset.monochrome,
    settings: enforceImagePolicy(settings, asset.monochrome),
    crop: crop ? { cropX: crop.x, cropY: crop.y, cropZoom: crop.zoom } : null,
    aspect: policy?.aspect ?? null,
  };
}

const presentationSchema = z
  .object({
    settings: imageAdjustmentsSchema,
    revision: fingerprintSchema,
    crop: updateMediaCropSchema
      .pick({ cropX: true, cropY: true, cropZoom: true })
      .optional(),
  })
  .strict();

export async function saveImagePresentation(
  source: string,
  input: z.input<typeof presentationSchema>,
): Promise<
  | (StoredImageAdjustments & { revision: string })
  | { error: "stale"; message: string }
> {
  try {
    return await savePresentation(source, input);
  } catch (error) {
    // Expected conflicts must survive Next's production server-error redaction.
    // Return only this fixed safe message, never SQL/parameters or arbitrary errors.
    if (error instanceof Error && error.message === STALE_IMAGE_PRESENTATION)
      return { error: "stale", message: STALE_IMAGE_PRESENTATION };
    throw error;
  }
}

async function savePresentation(
  source: string,
  input: z.input<typeof presentationSchema>,
): Promise<StoredImageAdjustments & { revision: string }> {
  const data = presentationSchema.parse(input);
  let asset: Awaited<ReturnType<typeof resolveImage>>;
  try {
    asset = await resolveImage(source);
  } catch (error) {
    if (!(error instanceof MissingImageError)) throw error;
    // A removed crop/reprocess alias cannot resolve to a current row. With a
    // valid loaded revision this is a reload/review outcome, never a write.
    // Known originals/documents remain explicitly unsupported even on Save.
    const [original, document] = await Promise.all([
      db.query.media.findFirst({
        where: eq(media.originalS3Key, error.key),
        columns: { id: true },
      }),
      db.query.commentAttachments.findFirst({
        where: and(
          eq(commentAttachments.s3Key, error.key),
          eq(commentAttachments.isImage, false),
        ),
        columns: { id: true },
      }),
    ]);
    if (original || document) throw new Error("Image not found");
    throw new Error(STALE_IMAGE_PRESENTATION);
  }
  const item = asset.media;
  const policy = item ? await editorPolicy(item) : null;
  if (data.crop && !policy?.supportsCrop)
    throw new Error("This image does not support framed cropping");
  const settings = enforceImagePolicy(data.settings, asset.monochrome);

  if (!item) {
    const record = {
      assetKey: asset.assetKey,
      sources: asset.sources,
      settings,
      monochrome: asset.monochrome,
    };
    const results = await withReadableErrors(() =>
      atomic((d) => [
        ...imagePresentationLocks(asset.subject, asset.assetKey).map((query) =>
          d.execute(query),
        ),
        d.execute(assertImageRevision(asset.subject, data.revision)),
        d
          .insert(imageAdjustments)
          .values(record)
          .onConflictDoUpdate({
            target: imageAdjustments.assetKey,
            set: { ...record, updatedAt: sql`clock_timestamp()` },
          }),
        d.execute(sql`select ${imageRevisionSql(asset.subject)} as revision`),
      ]),
    );
    const revision = resultRows<{ revision: string }>(results.at(-1))[0]
      .revision;
    invalidateImages();
    return { ...record, revision };
  }

  // A crop is written into new files. The uncropped image is never modified.
  const crop = data.crop && {
    x: data.crop.cropX,
    y: data.crop.cropY,
    zoom: data.crop.cropZoom,
  };
  // Unchanged legacy framing is not a request to bake the current raster.
  // Filter-only saves must retain source bytes and legacy CSS zoom.
  const cropChanged = crop && !sameCrop(crop, editorCrop(item));
  const files = cropChanged ? await buildDisplayFiles(item, crop) : null;
  const updated = await commitDisplay(
    item,
    files,
    {
      brightness: settings.brightness,
      contrast: settings.contrast,
      ...(cropChanged && displayFraming(crop)),
    },
    { settings, monochrome: asset.monochrome },
    { revision: data.revision },
  );
  if (!updated) throw new Error(STALE_IMAGE_PRESENTATION);
  invalidateImages();
  return {
    assetKey: updated.s3Key,
    sources: [updated.s3Key, updated.thumbnailS3Key]
      .filter((k): k is string => !!k)
      .map(s3ImageSource),
    settings,
    monochrome: asset.monochrome,
    revision: updated.revision!,
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
