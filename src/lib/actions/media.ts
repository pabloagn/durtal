"use server";

import { eq, and, asc, desc, inArray, not } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { deleteFromS3 } from "@/lib/s3";
import type { CreateMediaInput, UpdateMediaInput, UpdateMediaCropInput } from "@/lib/validations/media";
import { createMediaSchema, updateMediaSchema, updateMediaCropSchema } from "@/lib/validations/media";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { recordActivity } from "@/lib/activity/record";

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

export async function getPoster(entityType: "work" | "author", entityId: string) {
  const col = entityType === "work" ? media.workId : media.authorId;
  return db.query.media.findFirst({
    where: and(eq(col, entityId), eq(media.type, "poster"), eq(media.isActive, true)),
    orderBy: [asc(media.sortOrder)],
  });
}

export async function getBackground(entityType: "work" | "author", entityId: string) {
  const col = entityType === "work" ? media.workId : media.authorId;
  return db.query.media.findFirst({
    where: and(eq(col, entityId), eq(media.type, "background"), eq(media.isActive, true)),
    orderBy: [asc(media.sortOrder)],
  });
}

export async function getMediaByType(workId: string, type: string) {
  return db.query.media.findMany({
    where: and(eq(media.workId, workId), eq(media.type, type)),
    orderBy: [desc(media.isActive), asc(media.sortOrder), desc(media.createdAt)],
  });
}

// ── Mutations ───────────────────────────────────────────────────────────────

export async function createMedia(input: CreateMediaInput) {
  const data = createMediaSchema.parse(input);
  const [row] = await db.insert(media).values(data).returning();

  const entityType = data.workId ? "work" : "author";
  const entityId = (data.workId ?? data.authorId)!;
  recordActivity(entityType as "work" | "author", entityId, `${entityType}.${data.type}_uploaded`);

  invalidate(CACHE_TAGS.works, CACHE_TAGS.media);
  return row;
}

export async function updateMedia(id: string, input: UpdateMediaInput) {
  const data = updateMediaSchema.parse(input);
  const [row] = await db.update(media).set(data).where(eq(media.id, id)).returning();
  invalidate(CACHE_TAGS.works, CACHE_TAGS.media);
  return row;
}

export async function deleteMedia(id: string) {
  const existing = await db.query.media.findFirst({ where: eq(media.id, id) });
  if (!existing) return;

  // Delete S3 objects
  const deletions = [deleteFromS3(existing.s3Key)];
  if (existing.thumbnailS3Key) {
    deletions.push(deleteFromS3(existing.thumbnailS3Key));
  }
  if (existing.originalS3Key) {
    deletions.push(deleteFromS3(existing.originalS3Key));
  }
  await Promise.all(deletions);

  const entityType = existing.workId ? "work" : "author";
  const entityId = (existing.workId ?? existing.authorId)!;
  recordActivity(entityType as "work" | "author", entityId, `${entityType}.${existing.type}_deleted`);

  await db.delete(media).where(eq(media.id, id));
  invalidate(CACHE_TAGS.works, CACHE_TAGS.media);
}

export async function bulkDeleteMedia(ids: string[]) {
  if (ids.length === 0) return;
  const items = await db.query.media.findMany({
    where: inArray(media.id, ids),
  });
  // Delete S3 objects
  const deletions: Promise<void>[] = [];
  for (const item of items) {
    deletions.push(deleteFromS3(item.s3Key));
    if (item.thumbnailS3Key) deletions.push(deleteFromS3(item.thumbnailS3Key));
    if (item.originalS3Key) deletions.push(deleteFromS3(item.originalS3Key));
  }
  await Promise.all(deletions);
  // Delete DB records
  await db.delete(media).where(inArray(media.id, ids));
  invalidate(CACHE_TAGS.works, CACHE_TAGS.media);
}

/**
 * Set a media item as active, deactivating all others of the same type+owner.
 */
export async function setActiveMedia(id: string) {
  const item = await db.query.media.findFirst({ where: eq(media.id, id) });
  if (!item) return;

  // Deactivate all others of same type for this owner
  const ownerCol = item.workId ? media.workId : media.authorId;
  const ownerId = item.workId ?? item.authorId!;
  await db.update(media)
    .set({ isActive: false })
    .where(and(eq(ownerCol, ownerId), eq(media.type, item.type), not(eq(media.id, id))));

  // Activate this one
  await db.update(media)
    .set({ isActive: true })
    .where(eq(media.id, id));

  const entityType = item.workId ? "work" : "author";
  const entityId = (item.workId ?? item.authorId)!;
  recordActivity(entityType as "work" | "author", entityId, `${entityType}.${item.type}_default_changed`);

  invalidate(CACHE_TAGS.works, CACHE_TAGS.media);
}

export async function updateMediaCrop(id: string, input: UpdateMediaCropInput) {
  const data = updateMediaCropSchema.parse(input);
  const [row] = await db
    .update(media)
    .set(data)
    .where(eq(media.id, id))
    .returning();
  invalidate(CACHE_TAGS.works, CACHE_TAGS.media);
  return row;
}

export async function reorderMedia(ids: string[]) {
  await Promise.all(
    ids.map((id, i) =>
      db.update(media).set({ sortOrder: i }).where(eq(media.id, id)),
    ),
  );
}
