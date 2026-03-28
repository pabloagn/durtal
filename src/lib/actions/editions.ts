"use server";

import { db } from "@/lib/db";
import {
  editions,
  editionContributors,
  editionGenres,
  editionTags,
} from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import {
  createEditionSchema,
  type CreateEditionInput,
} from "@/lib/validations";
import { processAndUploadCover } from "@/lib/s3/covers";

export async function getEdition(id: string) {
  return db.query.editions.findFirst({
    where: eq(editions.id, id),
    with: {
      work: true,
      instances: {
        with: {
          location: true,
          subLocation: true,
        },
      },
      contributors: {
        with: { author: true },
        orderBy: asc(editionContributors.sortOrder),
      },
      editionGenres: {
        with: { genre: true },
      },
      editionTags: {
        with: { tag: true },
      },
    },
  });
}

export async function createEdition(input: CreateEditionInput) {
  const parsed = createEditionSchema.parse(input);
  const { contributorIds, genreIds, tagIds, coverSourceUrl, ...editionData } =
    parsed;

  // Process cover if URL provided
  let coverKeys: { coverS3Key?: string; thumbnailS3Key?: string } = {};

  const [edition] = await db
    .insert(editions)
    .values(editionData)
    .returning();

  if (coverSourceUrl) {
    const result = await processAndUploadCover(edition.id, coverSourceUrl);
    if (result) {
      coverKeys = {
        coverS3Key: result.coverKey,
        thumbnailS3Key: result.thumbnailKey,
      };
      await db
        .update(editions)
        .set({
          coverS3Key: result.coverKey,
          thumbnailS3Key: result.thumbnailKey,
          coverSourceUrl,
        })
        .where(eq(editions.id, edition.id));
    }
  }

  // Link contributors
  if (contributorIds && contributorIds.length > 0) {
    await db.insert(editionContributors).values(
      contributorIds.map((c, i) => ({
        editionId: edition.id,
        authorId: c.authorId,
        role: c.role,
        sortOrder: i,
      })),
    );
  }

  // Link genres
  if (genreIds && genreIds.length > 0) {
    await db.insert(editionGenres).values(
      genreIds.map((genreId) => ({
        editionId: edition.id,
        genreId,
      })),
    );
  }

  // Link tags
  if (tagIds && tagIds.length > 0) {
    await db.insert(editionTags).values(
      tagIds.map((tagId) => ({
        editionId: edition.id,
        tagId,
      })),
    );
  }

  return { ...edition, ...coverKeys };
}

export async function updateEdition(
  id: string,
  input: Partial<CreateEditionInput>,
) {
  const { contributorIds, genreIds, tagIds, coverSourceUrl, ...editionData } =
    input;

  const updates: Record<string, unknown> = {
    ...editionData,
    updatedAt: new Date(),
  };

  // Re-process cover if new URL
  if (coverSourceUrl) {
    const result = await processAndUploadCover(id, coverSourceUrl);
    if (result) {
      updates.coverS3Key = result.coverKey;
      updates.thumbnailS3Key = result.thumbnailKey;
      updates.coverSourceUrl = coverSourceUrl;
    }
  }

  await db.update(editions).set(updates).where(eq(editions.id, id));

  if (contributorIds) {
    await db
      .delete(editionContributors)
      .where(eq(editionContributors.editionId, id));
    if (contributorIds.length > 0) {
      await db.insert(editionContributors).values(
        contributorIds.map((c, i) => ({
          editionId: id,
          authorId: c.authorId,
          role: c.role,
          sortOrder: i,
        })),
      );
    }
  }

  if (genreIds) {
    await db.delete(editionGenres).where(eq(editionGenres.editionId, id));
    if (genreIds.length > 0) {
      await db.insert(editionGenres).values(
        genreIds.map((genreId) => ({
          editionId: id,
          genreId,
        })),
      );
    }
  }

  if (tagIds) {
    await db.delete(editionTags).where(eq(editionTags.editionId, id));
    if (tagIds.length > 0) {
      await db.insert(editionTags).values(
        tagIds.map((tagId) => ({
          editionId: id,
          tagId,
        })),
      );
    }
  }

  return { id };
}

export async function deleteEdition(id: string) {
  await db.delete(editions).where(eq(editions.id, id));
  return { id };
}
