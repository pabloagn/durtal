"use server";

import { db } from "@/lib/db";
import { collections, collectionEditions } from "@/lib/db/schema";
import { eq, asc, and } from "drizzle-orm";

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
