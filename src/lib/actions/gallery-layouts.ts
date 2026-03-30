"use server";

import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { galleryLayouts, media } from "@/lib/db/schema";
import { computeCollageLayout } from "@/lib/utils/collage-layout";
import type { CollageLayoutData } from "@/lib/utils/collage-layout";

// ── Queries ──────────────────────────────────────────────────────────────────

export async function getGalleryLayout(
  entityType: "work" | "author",
  entityId: string,
) {
  return db.query.galleryLayouts.findFirst({
    where: and(
      eq(galleryLayouts.entityType, entityType),
      eq(galleryLayouts.entityId, entityId),
    ),
  });
}

// ── Compute and store ─────────────────────────────────────────────────────────

export async function computeAndStoreLayout(
  entityType: "work" | "author",
  entityId: string,
  seed?: number,
) {
  // Fetch gallery media for this entity
  const mediaCol =
    entityType === "work" ? media.workId : media.authorId;

  const items = await db.query.media.findMany({
    where: and(eq(mediaCol, entityId), eq(media.type, "gallery")),
    orderBy: (m, { asc }) => [asc(m.sortOrder), asc(m.createdAt)],
  });

  // Resolve seed
  const resolvedSeed =
    seed !== undefined
      ? seed
      : Math.floor(Math.random() * 2 ** 31);

  const layoutData = computeCollageLayout(
    items.map((m) => ({ id: m.id, width: m.width, height: m.height })),
    resolvedSeed,
  );

  // Upsert
  const existing = await db.query.galleryLayouts.findFirst({
    where: and(
      eq(galleryLayouts.entityType, entityType),
      eq(galleryLayouts.entityId, entityId),
    ),
  });

  if (existing) {
    const [row] = await db
      .update(galleryLayouts)
      .set({
        layoutData: layoutData as unknown as Record<string, unknown>,
        seed: resolvedSeed,
        imageCount: items.length,
        updatedAt: new Date(),
      })
      .where(eq(galleryLayouts.id, existing.id))
      .returning();
    return row;
  } else {
    const [row] = await db
      .insert(galleryLayouts)
      .values({
        entityType,
        entityId,
        layoutData: layoutData as unknown as Record<string, unknown>,
        seed: resolvedSeed,
        imageCount: items.length,
      })
      .returning();
    return row;
  }
}

// ── Randomize ─────────────────────────────────────────────────────────────────

export async function randomizeLayout(
  entityType: "work" | "author",
  entityId: string,
) {
  const newSeed = Math.floor(Math.random() * 2 ** 31);
  return computeAndStoreLayout(entityType, entityId, newSeed);
}

// ── Invalidate ────────────────────────────────────────────────────────────────

export async function invalidateLayout(
  entityType: "work" | "author",
  entityId: string,
) {
  await db
    .delete(galleryLayouts)
    .where(
      and(
        eq(galleryLayouts.entityType, entityType),
        eq(galleryLayouts.entityId, entityId),
      ),
    );
}

// ── Fetch gallery media + layout (combined) ───────────────────────────────────

export async function getGalleryWithLayout(
  entityType: "work" | "author",
  entityId: string,
): Promise<{ mediaItems: Awaited<ReturnType<typeof fetchGalleryMedia>>; layout: CollageLayoutData }> {
  const items = await fetchGalleryMedia(entityType, entityId);

  let layout = await getGalleryLayout(entityType, entityId);

  // Recompute if missing or stale
  if (!layout || layout.imageCount !== items.length) {
    const existingSeed = layout?.seed;
    layout = await computeAndStoreLayout(
      entityType,
      entityId,
      existingSeed,
    );
  }

  const layoutData = layout?.layoutData as unknown as CollageLayoutData ?? { blocks: [] };

  return { mediaItems: items, layout: layoutData };
}

async function fetchGalleryMedia(
  entityType: "work" | "author",
  entityId: string,
) {
  const mediaCol = entityType === "work" ? media.workId : media.authorId;
  return db.query.media.findMany({
    where: and(eq(mediaCol, entityId), eq(media.type, "gallery")),
    orderBy: (m, { asc }) => [asc(m.sortOrder), asc(m.createdAt)],
  });
}
