"use server";

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  authors,
  works,
  workAuthors,
  workRecommenders,
  editions,
  editionGenres,
  editionTags,
  instances,
  collections,
  collectionEditions,
  locations,
} from "@/lib/db/schema";
import { eq, inArray, like, sql } from "drizzle-orm";
import { atomic } from "@/lib/db/atomic";
import { workTaxonomyWrites } from "@/lib/db/work-taxonomy";
import { wizardBookSchema, type WizardBookInput } from "@/lib/validations/wizard";
import { generateAuthorSlug, generateWorkSlug, makeUnique } from "@/lib/utils/slugify";
import { defaultSortName } from "@/lib/utils/author-names";
import { processAndUploadCover, deleteFromS3 } from "@/lib/s3/covers";
import { recordActivity } from "@/lib/activity/record";
import { invalidate, CACHE_TAGS } from "@/lib/cache";

async function uniqueSlug(table: typeof works | typeof authors, base: string): Promise<string> {
  const rows = await db.select({ slug: table.slug }).from(table).where(like(table.slug, `${base}%`));
  return makeUnique(base, rows.map((r) => r.slug).filter((s): s is string => s !== null));
}

/** True when another edition already uses this ISBN-13 (instant check on the wizard's edition step). */
export async function isIsbnInUse(isbn13: string): Promise<{ inUse: boolean; title?: string }> {
  const clean = String(isbn13).replace(/[^0-9]/g, "");
  if (clean.length !== 13) return { inUse: false };
  const existing = await db.query.editions.findFirst({
    where: eq(editions.isbn13, clean),
    columns: { title: true },
  });
  return existing ? { inUse: true, title: existing.title ?? undefined } : { inUse: false };
}

export type WizardBookResult =
  | { ok: true; workId: string; slug: string | null; editionId: string }
  | { ok: false; error: string };

/**
 * Add a book from the wizard in one step: validate everything, check what can
 * fail (duplicate ISBN, unknown work, location or collection), then write the
 * author, work, taxonomy, edition, copies and collection links in ONE atomic
 * write. A failure leaves nothing behind (a cover already uploaded is removed).
 *
 * Errors come back as `{ ok: false, error }`: a production build hides the
 * message of an error thrown from a server action.
 */
export async function createBookFromWizard(input: WizardBookInput): Promise<WizardBookResult> {
  const parsed = wizardBookSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue.path.join(".") || "input"}: ${issue.message}` };
  }
  const data = parsed.data;
  const { coverSourceUrl, genreIds, tagIds, ...editionValues } = data.edition;

  // ── 1. Checks (reads only) ───────────────────────────────────────────────
  if (editionValues.isbn13) {
    const clash = await isIsbnInUse(editionValues.isbn13);
    if (clash.inUse) {
      return { ok: false, error: `An edition with ISBN ${editionValues.isbn13} already exists${clash.title ? ` ("${clash.title}")` : ""}` };
    }
  }

  const locationIds = [...new Set(data.copies.map((c) => c.locationId))];
  if (locationIds.length > 0) {
    const found = await db.select({ id: locations.id }).from(locations).where(inArray(locations.id, locationIds));
    if (found.length !== locationIds.length) return { ok: false, error: "A selected location no longer exists" };
  }
  if (data.collectionIds.length > 0) {
    const found = await db.select({ id: collections.id }).from(collections).where(inArray(collections.id, data.collectionIds));
    if (found.length !== new Set(data.collectionIds).size) return { ok: false, error: "A selected collection no longer exists" };
  }

  // ── 2. Work and author (new rows get their ids and slugs now) ──────────────
  let workId: string;
  let workSlug: string | null;
  let newWork: (typeof works.$inferInsert) | null = null;
  let newAuthor: (typeof authors.$inferInsert) | null = null;
  let authorId: string | null = null;

  if (data.existingWorkId) {
    const existing = await db.query.works.findFirst({
      where: eq(works.id, data.existingWorkId),
      columns: { id: true, slug: true },
    });
    if (!existing) return { ok: false, error: "The selected work no longer exists" };
    workId = existing.id;
    workSlug = existing.slug;
  } else {
    const authorName = data.authorName;
    const found = await db.query.authors.findFirst({
      where: sql`lower(${authors.name}) = lower(${authorName})`,
      columns: { id: true, name: true },
    });
    if (found) {
      authorId = found.id;
    } else {
      authorId = randomUUID();
      newAuthor = {
        id: authorId,
        name: authorName,
        sortName: defaultSortName(authorName),
        slug: await uniqueSlug(authors, generateAuthorSlug(authorName)),
      };
    }
    workId = randomUUID();
    workSlug = await uniqueSlug(works, generateWorkSlug(data.work!.title, found?.name ?? authorName, workId));
    const { recommenderIds: _recommenders, ...workValues } = data.work!;
    newWork = { ...workValues, id: workId, slug: workSlug };
  }

  // ── 3. Cover (stored under the new edition id before the write) ──────────
  const editionId = randomUUID();
  const cover = coverSourceUrl ? await processAndUploadCover(editionId, coverSourceUrl) : null;

  // ── 4. One atomic write ───────────────────────────────────────────────────
  const instanceIds = data.copies.map(() => randomUUID());
  const recommenderIds = data.work?.recommenderIds ?? [];
  try {
    await atomic((d) => [
      ...(newAuthor ? [d.insert(authors).values(newAuthor)] : []),
      ...(newWork
        ? [
            d.insert(works).values(newWork),
            d.insert(workAuthors).values({ workId, authorId: authorId!, role: "author", sortOrder: 0 }),
            ...(recommenderIds.length > 0
              ? [d.insert(workRecommenders).values(recommenderIds.map((recommenderId) => ({ workId, recommenderId })))]
              : []),
            ...workTaxonomyWrites(d, workId, data.taxonomy ?? {}, { replace: false }),
          ]
        : []),
      d.insert(editions).values({
        ...editionValues,
        id: editionId,
        workId,
        ...(cover ? { coverS3Key: cover.coverKey, thumbnailS3Key: cover.thumbnailKey, coverSourceUrl } : {}),
      }),
      ...(genreIds && genreIds.length > 0 ? [d.insert(editionGenres).values(genreIds.map((genreId) => ({ editionId, genreId })))] : []),
      ...(tagIds && tagIds.length > 0 ? [d.insert(editionTags).values(tagIds.map((tagId) => ({ editionId, tagId })))] : []),
      ...data.copies.map((copy, i) => d.insert(instances).values({ ...copy, id: instanceIds[i], editionId })),
      ...[...new Set(data.collectionIds)].map((collectionId) =>
        d.insert(collectionEditions).values({ collectionId, editionId, sortOrder: 0 }).onConflictDoNothing(),
      ),
    ]);
  } catch (err) {
    if (cover) await Promise.allSettled([deleteFromS3(cover.coverKey), deleteFromS3(cover.thumbnailKey)]);
    console.error("createBookFromWizard: the write failed, nothing was saved", err);
    return { ok: false, error: "Could not add the book. Nothing was saved." };
  }

  // ── 5. Activity, after the write succeeded ────────────────────────────────
  if (newAuthor) recordActivity("author", newAuthor.id!, "author.created", { newValue: newAuthor.name });
  if (newWork) recordActivity("work", workId, "work.created", { newValue: newWork.title });
  recordActivity("work", workId, "work.edition_added", {
    targetName: editionValues.title,
    targetId: editionId,
    editionIsbn: editionValues.isbn13 ?? undefined,
  });
  for (const id of instanceIds) recordActivity("work", workId, "work.instance_added", { targetId: id });
  for (const collectionId of new Set(data.collectionIds)) recordActivity("work", workId, "work.collection_added", { extra: { collectionId } });
  invalidate(CACHE_TAGS.works);

  return { ok: true, workId, slug: workSlug, editionId };
}
