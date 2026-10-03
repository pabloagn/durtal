"use server";

import { requireBookWork } from "@/lib/catalogue/book-boundary";

import { randomUUID } from "node:crypto";
import { atomic } from "@/lib/db/atomic";
import { editionContributorQueries } from "@/lib/catalogue/book-credits";
import { db } from "@/lib/db";
import {
  editions,
  editionContributors,
  editionGenres,
  editionTags,
} from "@/lib/db/schema";
import { eq, asc, sql } from "drizzle-orm";
import {
  createEditionSchema,
  type CreateEditionInput,
} from "@/lib/validations";
import { processAndUploadCover } from "@/lib/s3/covers";
import { deleteUnusedObjects, keysOf, ownedPrefixes } from "@/lib/s3/cleanup";
import { recordActivity } from "@/lib/activity/record";
import { autoResolveEditions } from "@/lib/publishers/resolution";

export async function getEdition(id: string) {
  return db.query.editions.findFirst({
    where: eq(editions.id, id),
    with: {
      work: true,
      publisherLinks: { with: { publisher: true } },
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
  await requireBookWork(parsed.workId);
  const {
    publisherIds,
    contributorIds,
    genreIds,
    tagIds,
    coverSourceUrl,
    ...editionData
  } = parsed;

  // Check for duplicate ISBN-13 before inserting
  if (editionData.isbn13) {
    const existing = await db.query.editions.findFirst({
      where: eq(editions.isbn13, editionData.isbn13),
      columns: { id: true, title: true },
    });
    if (existing) {
      throw new Error(
        `An edition with ISBN ${editionData.isbn13} already exists${existing.title ? ` ("${existing.title}")` : ""}`,
      );
    }
  }

  // Process cover if URL provided
  let coverKeys: { coverS3Key?: string; thumbnailS3Key?: string } = {};

  const editionId = randomUUID();
  const results = await atomic((d) => [
    d
      .insert(editions)
      .values({
        ...editionData,
        id: editionId,
        publisherLinksConfirmed: publisherIds !== undefined,
      })
      .returning(),
    ...(publisherIds !== undefined
      ? [
          d.execute(
            sql`select set_edition_publishers(${editionId}::uuid, ARRAY(select jsonb_array_elements_text(${JSON.stringify(publisherIds)}::jsonb)::uuid))`,
          ),
        ]
      : []),
  ]);
  const [edition] = results[0] as (typeof editions.$inferSelect)[];

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

  recordActivity("work", editionData.workId, "work.edition_added", {
    targetName: edition.title ?? undefined,
    targetId: edition.id,
    editionIsbn: edition.isbn13 ?? undefined,
  });

  // A publisher name no house knows yet is decided when it is safe
  await autoResolveEditions([edition.id]);

  return { ...edition, ...coverKeys };
}

export async function updateEdition(
  id: string,
  input: Partial<CreateEditionInput>,
) {
  const parsed = createEditionSchema.partial().parse(input);
  if (parsed.workId !== undefined) await requireBookWork(parsed.workId);
  // Zod defaults also run inside partial schemas. Never apply defaults to omitted edits.
  for (const key of Object.keys(parsed) as (keyof typeof parsed)[]) {
    if (input[key] === undefined) delete parsed[key];
  }
  const {
    publisherIds,
    contributorIds,
    genreIds,
    tagIds,
    coverSourceUrl,
    ...editionData
  } = parsed;

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

  await atomic((d) => [
    d.update(editions).set(updates).where(eq(editions.id, id)),
    ...(publisherIds !== undefined
      ? [
          d.execute(
            sql`select set_edition_publishers(${id}::uuid, ARRAY(select jsonb_array_elements_text(${JSON.stringify(publisherIds)}::jsonb)::uuid))`,
          ),
        ]
      : []),
  ]);

  if (contributorIds) await atomic((d) => editionContributorQueries(d, id, contributorIds));

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

  // Record activity — resolve workId from editionData or fetch from DB
  const workId =
    editionData.workId ??
    (
      await db.query.editions.findFirst({
        where: eq(editions.id, id),
        columns: { workId: true },
      })
    )?.workId;
  if (workId) {
    recordActivity("work", workId, "work.edition_updated", { targetId: id });
  }

  // A new publisher text or ISBN gets the same safe automatic decision
  if (
    ["publisher", "imprint", "isbn13", "isbn10"].some((k) => k in parsed) &&
    publisherIds === undefined
  )
    await autoResolveEditions([id]);

  return { id };
}

export async function deleteEdition(id: string) {
  const [edition] = await db
    .delete(editions)
    .where(eq(editions.id, id))
    .returning({
      workId: editions.workId,
      title: editions.title,
      coverS3Key: editions.coverS3Key,
      thumbnailS3Key: editions.thumbnailS3Key,
    });
  if (!edition) return { id, cleanupPending: false };

  recordActivity("work", edition.workId, "work.edition_deleted", {
    targetName: edition.title ?? undefined,
    targetId: id,
  });

  const cleanupPending = await deleteUnusedObjects(
    {
      keys: keysOf([
        { cover: edition.coverS3Key, thumb: edition.thumbnailS3Key },
      ]),
      prefixes: ownedPrefixes.edition(id),
    },
    `edition ${id}`,
  );
  return { id, cleanupPending };
}

/**
 * Get the primary (first) edition for a work.
 * Used by the match-again dialog to know which edition to match.
 */
export async function getPrimaryEdition(workId: string) {
  const edition = await db.query.editions.findFirst({
    where: eq(editions.workId, workId),
    columns: {
      id: true,
      title: true,
      metadataSource: true,
      metadataLastFetched: true,
      isbn13: true,
      isbn10: true,
      googleBooksId: true,
      openLibraryKey: true,
    },
  });
  return edition ?? null;
}
