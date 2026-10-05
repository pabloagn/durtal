"use server";

import { requireBookWork } from "@/lib/catalogue/book-boundary";

import { atomic } from "@/lib/db/atomic";
import { editionContributorQueries } from "@/lib/catalogue/book-credits";
import {
  newAuthorQueries,
  planBookEdition,
  resolveBookCredits,
} from "@/lib/catalogue/book-store";
import { db } from "@/lib/db";
import {
  editions,
  editionGenres,
  editionTags,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  createEditionSchema,
  updateEditionSchema,
  type CreateEditionInput,
  type UpdateEditionInput,
} from "@/lib/validations";
import { parseId } from "@/lib/validations/helpers";
import { processAndUploadCover } from "@/lib/s3/covers";
import { deleteUnusedObjects, keysOf, ownedPrefixes } from "@/lib/s3/cleanup";
import { recordActivity } from "@/lib/activity/record";
import { autoResolveEditions } from "@/lib/publishers/resolution";
import { isbnClash, isbnTaken } from "@/lib/catalogue/isbn-clash";

export async function createEdition(input: CreateEditionInput) {
  const parsed = createEditionSchema.parse(input);
  await requireBookWork(parsed.workId);

  // An ISBN another edition holds is refused before anything is uploaded
  const clash = await isbnClash(parsed);
  if (clash) throw new Error(clash);

  // The cover is uploaded first; the edition, its links and any contributor
  // created by name are one write. A failed write removes the uploaded cover
  // and leaves no edition and no new author behind.
  const { credits, newAuthors } = await resolveBookCredits(parsed.contributorIds);
  const plan = await planBookEdition({ ...parsed, contributorIds: credits });
  try {
    await atomic((d) => [
      ...newAuthors.flatMap((author) => newAuthorQueries(d, author)),
      ...plan.queries(d),
    ]);
  } catch (err) {
    await plan.discardCover();
    const taken = isbnTaken(err, parsed);
    throw taken ? new Error(taken, { cause: err }) : err;
  }

  // A publisher name no house knows yet is decided when it is safe
  await autoResolveEditions([plan.id]);

  const edition = await db.query.editions.findFirst({
    where: eq(editions.id, plan.id),
  });
  return { ...edition!, coverUnavailable: plan.coverUnavailable };
}

export async function updateEdition(id: string, input: UpdateEditionInput) {
  parseId(id);
  // No defaults (an omitted field keeps its stored value), unknown keys rejected
  const parsed = updateEditionSchema.parse(input);
  if (parsed.workId !== undefined) await requireBookWork(parsed.workId);
  const {
    publisherIds,
    contributorIds,
    genreIds,
    tagIds,
    coverSourceUrl,
    ...editionData
  } = parsed;

  const clash = await isbnClash(editionData, id);
  if (clash) throw new Error(clash);

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

  // The edition, every link the edit names and any contributor created by
  // name are one write
  const { credits, newAuthors } = await resolveBookCredits(contributorIds);
  try {
    await atomic((d) => [
      ...newAuthors.flatMap((author) => newAuthorQueries(d, author)),
      // An edition moved to another book leaves the old book's readings: they
      // keep their page totals, without this edition or its copy
      ...(editionData.workId !== undefined
        ? [
            d.execute(sql`update reading_sessions s set edition_id = null, updated_at = now() from readings r
              where s.reading_id = r.id and s.edition_id = ${id}::uuid and r.work_id <> ${editionData.workId}::uuid`),
            d.execute(sql`update readings set edition_id = null, instance_id = null, updated_at = now()
              where edition_id = ${id}::uuid and work_id <> ${editionData.workId}::uuid`),
            // The old book stays in Up Next, without this edition (SLN-452)
            d.execute(sql`update reading_queue set edition_id = null
              where edition_id = ${id}::uuid and work_id <> ${editionData.workId}::uuid`),
          ]
        : []),
      d.update(editions).set(updates).where(eq(editions.id, id)),
      ...(publisherIds !== undefined
        ? [
            d.execute(
              sql`select set_edition_publishers(${id}::uuid, ARRAY(select jsonb_array_elements_text(${JSON.stringify(publisherIds)}::jsonb)::uuid))`,
            ),
          ]
        : []),
      ...(credits ? editionContributorQueries(d, id, credits) : []),
      ...(genreIds
        ? [
            d.delete(editionGenres).where(eq(editionGenres.editionId, id)),
            ...(genreIds.length
              ? [
                  d.insert(editionGenres).values(
                    [...new Set(genreIds)].map((genreId) => ({ editionId: id, genreId })),
                  ),
                ]
              : []),
          ]
        : []),
      ...(tagIds
        ? [
            d.delete(editionTags).where(eq(editionTags.editionId, id)),
            ...(tagIds.length
              ? [
                  d.insert(editionTags).values(
                    [...new Set(tagIds)].map((tagId) => ({ editionId: id, tagId })),
                  ),
                ]
              : []),
          ]
        : []),
    ]);
  } catch (err) {
    const taken = isbnTaken(err, editionData);
    throw taken ? new Error(taken, { cause: err }) : err;
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
