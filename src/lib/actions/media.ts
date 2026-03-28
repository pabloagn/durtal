"use server";

import { eq, and, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { deleteFromS3 } from "@/lib/s3";
import type { CreateMediaInput, UpdateMediaInput } from "@/lib/validations/media";
import { createMediaSchema, updateMediaSchema } from "@/lib/validations/media";

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
    where: and(eq(col, entityId), eq(media.type, "poster")),
    orderBy: [asc(media.sortOrder)],
  });
}

export async function getBackground(entityType: "work" | "author", entityId: string) {
  const col = entityType === "work" ? media.workId : media.authorId;
  return db.query.media.findFirst({
    where: and(eq(col, entityId), eq(media.type, "background")),
    orderBy: [asc(media.sortOrder)],
  });
}

// ── Mutations ───────────────────────────────────────────────────────────────

export async function createMedia(input: CreateMediaInput) {
  const data = createMediaSchema.parse(input);
  const [row] = await db.insert(media).values(data).returning();
  return row;
}

export async function updateMedia(id: string, input: UpdateMediaInput) {
  const data = updateMediaSchema.parse(input);
  const [row] = await db.update(media).set(data).where(eq(media.id, id)).returning();
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
  await Promise.all(deletions);

  await db.delete(media).where(eq(media.id, id));
}

export async function reorderMedia(ids: string[]) {
  await Promise.all(
    ids.map((id, i) =>
      db.update(media).set({ sortOrder: i }).where(eq(media.id, id)),
    ),
  );
}
