"use server";

import { db } from "@/lib/db";
import { collections, collectionEditions, editions, works, workAuthors, authors } from "@/lib/db/schema";
import { eq, asc, and, ilike, or, sql } from "drizzle-orm";

export async function getCollections() {
  return db.query.collections.findMany({
    orderBy: asc(collections.sortOrder),
    with: {
      collectionEditions: {
        columns: { editionId: true },
      },
    },
  });
}

export async function getCollection(id: string) {
  return db.query.collections.findFirst({
    where: eq(collections.id, id),
    with: {
      collectionEditions: {
        orderBy: asc(collectionEditions.sortOrder),
        with: {
          edition: {
            with: {
              work: {
                with: {
                  workAuthors: {
                    with: { author: true },
                    limit: 1,
                  },
                },
              },
              instances: {
                columns: { id: true },
              },
            },
          },
        },
      },
    },
  });
}

export async function createCollection(input: {
  name: string;
  description?: string | null;
  sortOrder?: number;
}) {
  const [collection] = await db
    .insert(collections)
    .values(input)
    .returning();
  return collection;
}

export async function updateCollection(
  id: string,
  input: Partial<{
    name: string;
    description: string | null;
    coverS3Key: string | null;
    posterS3Key: string | null;
    posterThumbnailS3Key: string | null;
    backgroundS3Key: string | null;
    sortOrder: number;
  }>,
) {
  await db
    .update(collections)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(collections.id, id));
  return { id };
}

export async function deleteCollection(id: string) {
  await db.delete(collections).where(eq(collections.id, id));
  return { id };
}

export async function addEditionToCollection(
  collectionId: string,
  editionId: string,
  sortOrder = 0,
) {
  await db
    .insert(collectionEditions)
    .values({ collectionId, editionId, sortOrder })
    .onConflictDoNothing();
}

export async function removeEditionFromCollection(
  collectionId: string,
  editionId: string,
) {
  await db
    .delete(collectionEditions)
    .where(
      and(
        eq(collectionEditions.collectionId, collectionId),
        eq(collectionEditions.editionId, editionId),
      ),
    );
}

/**
 * Search editions by title or author name, for use in collection edition picker.
 * Returns lightweight results with cover thumbnails.
 */
export async function searchEditionsForPicker(search: string, limit = 20) {
  if (!search.trim()) return [];

  const term = `%${search.trim()}%`;

  const rows = await db
    .selectDistinctOn([editions.id], {
      editionId: editions.id,
      editionTitle: editions.title,
      thumbnailS3Key: editions.thumbnailS3Key,
      publicationYear: editions.publicationYear,
      publisher: editions.publisher,
      workId: works.id,
      workTitle: works.title,
      authorName: authors.name,
    })
    .from(editions)
    .innerJoin(works, eq(editions.workId, works.id))
    .leftJoin(workAuthors, eq(works.id, workAuthors.workId))
    .leftJoin(authors, eq(workAuthors.authorId, authors.id))
    .where(
      or(
        ilike(editions.title, term),
        ilike(works.title, term),
        ilike(authors.name, term),
      ),
    )
    .orderBy(editions.id, asc(editions.title))
    .limit(limit);

  return rows;
}

/**
 * Add multiple editions to a collection at once.
 */
export async function bulkAddEditionsToCollection(
  collectionId: string,
  editionIds: string[],
) {
  if (editionIds.length === 0) return;

  // Get current max sort order
  const existing = await db
    .select({ maxSort: sql<number>`coalesce(max(${collectionEditions.sortOrder}), -1)` })
    .from(collectionEditions)
    .where(eq(collectionEditions.collectionId, collectionId));

  let nextSort = (existing[0]?.maxSort ?? -1) + 1;

  await db
    .insert(collectionEditions)
    .values(
      editionIds.map((editionId) => ({
        collectionId,
        editionId,
        sortOrder: nextSort++,
      })),
    )
    .onConflictDoNothing();
}
