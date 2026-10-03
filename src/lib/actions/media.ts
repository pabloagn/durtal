"use server";

import { getImagePresentation, saveImagePresentation } from "./image-adjustments";
import { s3ImageSource } from "@/lib/utils/image-adjustments";
import { z } from "zod";
import { eq, and, asc, desc, inArray, not } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { MEDIA_OWNER_COLUMN, mediaOwnerOf } from "@/lib/media/owner";
import type { MediaEntityType } from "@/lib/s3/keys";
import { media } from "@/lib/db/schema";
import { deleteUnusedObjects } from "@/lib/s3/cleanup";
import type { CreateMediaInput, MediaAttribution, UpdateMediaInput, UpdateMediaCropInput } from "@/lib/validations/media";
import { createMediaSchema, mediaAttributionSchema, updateMediaSchema, updateMediaCropSchema } from "@/lib/validations/media";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { recordActivity } from "@/lib/activity/record";

type MediaRow = typeof media.$inferSelect;
export type MediaOwnerType = MediaEntityType;

const OWNER_COLUMN = MEDIA_OWNER_COLUMN;
const ownerOf = mediaOwnerOf;

/** Only works and authors have an activity timeline. */
function recordMediaActivity(item: MediaRow, event: string) {
  const owner = ownerOf(item);
  if (owner.type !== "work" && owner.type !== "author") return;
  recordActivity(owner.type, owner.id, `${owner.type}.${item.type}_${event}`);
}

function mediaChanged() {
  invalidate(CACHE_TAGS.works, CACHE_TAGS.media, CACHE_TAGS.collections);
}

/** Every stored file of a media item: display, uncropped and color original. */
function mediaFiles(item: MediaRow): string[] {
  return [item.s3Key, item.thumbnailS3Key, item.uncroppedS3Key, item.originalS3Key].filter(
    (key): key is string => !!key,
  );
}

/** Delete files after their rows are gone. Files another row uses stay. */

// ── Queries ─────────────────────────────────────────────────────────────────

export async function getMediaForWork(workId: string) {
  return db.query.media.findMany({
    where: eq(media.workId, workId),
    orderBy: [asc(media.sortOrder), asc(media.createdAt)],
  });
}

export async function getMediaForAuthor(authorId: string) {
  return db.query.media.findMany({
    where: eq(media.authorId, authorId),
    orderBy: [asc(media.sortOrder), asc(media.createdAt)],
  });
}

export async function getPoster(entityType: MediaOwnerType, entityId: string) {
  const col = OWNER_COLUMN[entityType];
  return db.query.media.findFirst({
    where: and(eq(col, entityId), eq(media.type, "poster"), eq(media.isActive, true)),
    orderBy: [asc(media.sortOrder)],
  });
}

export async function getBackground(entityType: MediaOwnerType, entityId: string) {
  const col = OWNER_COLUMN[entityType];
  return db.query.media.findFirst({
    where: and(eq(col, entityId), eq(media.type, "background"), eq(media.isActive, true)),
    orderBy: [asc(media.sortOrder)],
  });
}

export async function getMediaByType(
  workId: string,
  type: string,
  ownerType: MediaOwnerType = "work",
) {
  if (!(ownerType in OWNER_COLUMN)) throw new Error("Unknown media owner");
  return db.query.media.findMany({
    where: and(eq(OWNER_COLUMN[ownerType], workId), eq(media.type, type)),
    orderBy: [desc(media.isActive), asc(media.sortOrder), desc(media.createdAt)],
  });
}

// ── Mutations ───────────────────────────────────────────────────────────────

export async function createMedia(input: CreateMediaInput) {
  const data = createMediaSchema.parse(input);
  const [row] = await db.insert(media).values(data).returning();
  recordMediaActivity(row, "uploaded");
  mediaChanged();
  return row;
}

export async function updateMedia(id: string, input: UpdateMediaInput) {
  const data = updateMediaSchema.parse(input);
  const [row] = await db.update(media).set(data).where(eq(media.id, id)).returning();
  mediaChanged();
  return row;
}

/**
 * Alt text, credit, license and source of one image. Supplied fields replace
 * the stored values; null clears one. The file itself is never changed.
 */
export async function updateMediaDetails(id: string, input: MediaAttribution) {
  z.uuid().parse(id);
  const data = mediaAttributionSchema.parse(input);
  const [row] = await withReadableErrors(() =>
    db.update(media).set(data).where(eq(media.id, id)).returning(),
  );
  if (!row) throw new Error("Image not found");
  mediaChanged();
  return row;
}


export async function deleteMedia(id: string) {
  // Row first, then its files: a failed delete never leaves a row without files.
  const [existing] = await db.delete(media).where(eq(media.id, id)).returning();
  if (!existing) return;

  recordMediaActivity(existing, "deleted");

  // If the deleted item was active, auto-promote the next one
  if (existing.isActive) {
    const owner = ownerOf(existing);
    const next = await db.query.media.findFirst({
      where: and(eq(OWNER_COLUMN[owner.type], owner.id), eq(media.type, existing.type)),
      orderBy: asc(media.sortOrder),
    });
    if (next) {
      await setActiveMedia(next.id);
    }
  }

  mediaChanged();
  await deleteUnusedObjects(
    { keys: mediaFiles(existing), prefixes: [] },
    `media ${id}`,
  );
}

export async function bulkDeleteMedia(ids: string[]) {
  if (ids.length === 0) return;
  const items = await db
    .delete(media)
    .where(inArray(media.id, ids))
    .returning();
  mediaChanged();
  await deleteUnusedObjects(
    { keys: items.flatMap(mediaFiles), prefixes: [] },
    `media ${ids.join(",")}`,
  );
}

/**
 * Set a media item as active, deactivating all others of the same type+owner.
 */
export async function setActiveMedia(id: string) {
  const item = await db.query.media.findFirst({ where: eq(media.id, id) });
  if (!item) return;

  // One write: the owner never has zero or two active images of a type.
  const owner = ownerOf(item);
  await atomic((d) => [
    d
      .update(media)
      .set({ isActive: false })
      .where(and(eq(OWNER_COLUMN[owner.type], owner.id), eq(media.type, item.type), not(eq(media.id, id)))),
    d.update(media).set({ isActive: true }).where(eq(media.id, id)),
  ]);

  // Backfill color palette if this is a work poster without one
  if (item.workId && item.type === "poster" && !item.colorPalette && item.s3Key) {
    try {
      const { s3, S3_BUCKET } = await import("@/lib/s3/client");
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const { extractColorPalette } = await import("@/lib/color/extract-palette");
      const obj = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: item.s3Key }));
      const bytes = await obj.Body!.transformToByteArray();
      const palette = await extractColorPalette(Buffer.from(bytes));
      if (palette) {
        await db.update(media).set({ colorPalette: palette }).where(eq(media.id, id));
      }
    } catch (err) {
      console.error("Palette backfill on setActive failed (non-blocking):", err);
    }
  }

  recordMediaActivity(item, "default_changed");
  mediaChanged();
}

export async function updateMediaCrop(id: string, input: UpdateMediaCropInput) {
  const data = updateMediaCropSchema.parse(input);
  const item = await db.query.media.findFirst({ where: eq(media.id, id) });
  if (!item) throw new Error("Media not found");
  const source = s3ImageSource(item.s3Key);
  const current = await getImagePresentation(source);
  await saveImagePresentation(source, {
    settings: { ...current.settings, brightness: data.brightness ?? current.settings.brightness, contrast: data.contrast ?? current.settings.contrast },
    ...(item.type !== "gallery" ? { crop: { cropX: data.cropX, cropY: data.cropY, cropZoom: data.cropZoom } } : {}),
  });
  return db.query.media.findFirst({ where: eq(media.id, id) });
}

export async function reorderMedia(ids: string[]) {
  await Promise.all(
    ids.map((id, i) =>
      db.update(media).set({ sortOrder: i }).where(eq(media.id, id)),
    ),
  );
  mediaChanged();
}
