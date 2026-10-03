"use server";

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import {
  activityEvents,
  collections,
  editions,
  instances,
  locations,
  works,
} from "@/lib/db/schema";
import { bookCondition } from "@/lib/catalogue/book-boundary";
import {
  bookAuthorFor,
  newAuthorQueries,
  planBookEdition,
  planBookWork,
  resolveBookCredits,
} from "@/lib/catalogue/book-store";
import { workTaxonomyQueries } from "@/lib/catalogue/work-taxonomy";
import { addMembers, lockCollection } from "@/lib/collections/members";
import { autoResolveEditions } from "@/lib/publishers/resolution";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import {
  wizardBookSchema,
  type WizardBookInput,
} from "@/lib/validations/wizard";

/** The book that already uses an ISBN-13, for the wizard's edition step. */
export async function isIsbnInUse(
  isbn13: string,
): Promise<{ inUse: false } | { inUse: true; title: string | null }> {
  const clean = String(isbn13).replace(/[\s-]/g, "");
  if (!/^\d{13}$/.test(clean)) return { inUse: false };
  const existing = await db.query.editions.findFirst({
    where: eq(editions.isbn13, clean),
    columns: { title: true },
  });
  return existing ? { inUse: true, title: existing.title } : { inUse: false };
}

export type WizardBookResult =
  | {
      ok: true;
      workId: string;
      slug: string | null;
      editionId: string;
      coverUnavailable: boolean;
    }
  | { ok: false; error: string };

/**
 * Adds a book from the wizard in one write. Everything that can fail is
 * checked first (the input, a duplicate ISBN, the book, locations and
 * collections it names); the new rows then get their ids and slugs and the
 * cover is uploaded. The author, work, taxonomy, edition, copies, collection
 * links and their activity go out as one atomic batch: a failure writes
 * nothing and removes the uploaded cover.
 *
 * Errors come back as `{ ok: false, error }`, because a production build hides
 * the message of an error thrown from a server action.
 */
export async function createBookFromWizard(
  input: WizardBookInput,
): Promise<WizardBookResult> {
  const parsed = wizardBookSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: `${issue.path.join(".") || "input"}: ${issue.message}`,
    };
  }
  const book = parsed.data;
  const collectionIds = [...new Set(book.collectionIds)];

  // ── Checks: reads only ──────────────────────────────────────────────────
  if (book.edition.isbn13) {
    const clash = await isIsbnInUse(book.edition.isbn13);
    if (clash.inUse)
      return {
        ok: false,
        error: `An edition with ISBN ${book.edition.isbn13} already exists${clash.title ? ` ("${clash.title}")` : ""}`,
      };
  }
  const locationIds = [...new Set(book.copies.map((copy) => copy.locationId))];
  if (locationIds.length) {
    const found = await db
      .select({ id: locations.id })
      .from(locations)
      .where(inArray(locations.id, locationIds));
    if (found.length !== locationIds.length)
      return { ok: false, error: "A selected location no longer exists" };
  }
  if (collectionIds.length) {
    const found = await db
      .select({ id: collections.id })
      .from(collections)
      .where(inArray(collections.id, collectionIds));
    if (found.length !== collectionIds.length)
      return { ok: false, error: "A selected collection no longer exists" };
  }
  const existing = book.existingWorkId
    ? await db.query.works.findFirst({
        where: and(bookCondition, eq(works.id, book.existingWorkId)),
        columns: { id: true, slug: true },
      })
    : null;
  if (book.existingWorkId && !existing)
    return { ok: false, error: "The selected book no longer exists" };

  let edition: Awaited<ReturnType<typeof planBookEdition>> | null = null;
  try {
    // ── The new rows, decided before the write ────────────────────────────
    const author = existing ? null : await bookAuthorFor(book.authorName!);
    const work =
      existing || !author
        ? null
        : await planBookWork(
            {
              ...book.work!,
              authorIds: [{ authorId: author.id, role: "author" }],
            },
            author.name,
          );
    const workId = existing?.id ?? work!.id;
    const { credits, newAuthors } = await resolveBookCredits(
      book.edition.contributorIds,
      author ? [author] : [],
    );
    edition = await planBookEdition({
      ...book.edition,
      contributorIds: credits,
      workId,
    });
    const editionId = edition.id;
    const copyIds = book.copies.map(() => randomUUID());
    const taxonomy = book.taxonomy ?? {};
    const classified = Object.values(taxonomy).some((list) => list?.length);

    // ── One atomic write ──────────────────────────────────────────────────
    await atomic((d) => [
      ...(author ? newAuthorQueries(d, author) : []),
      ...newAuthors.flatMap((credited) => newAuthorQueries(d, credited)),
      ...(work
        ? [
            ...work.queries(d),
            ...workTaxonomyQueries(d, workId, taxonomy),
            ...(classified
              ? [
                  d.insert(activityEvents).values({
                    entityType: "work",
                    entityId: workId,
                    eventKey: "work.taxonomy_added",
                    metadata: { extra: { updated: true } },
                  }),
                ]
              : []),
          ]
        : []),
      ...edition!.queries(d),
      ...book.copies.map((copy, i) =>
        d.insert(instances).values({ ...copy, id: copyIds[i], editionId }),
      ),
      ...(copyIds.length
        ? [
            d.insert(activityEvents).values(
              copyIds.map((id) => ({
                entityType: "work",
                entityId: workId,
                eventKey: "work.instance_added",
                metadata: { targetId: id },
              })),
            ),
          ]
        : []),
      ...collectionIds.flatMap((collectionId) => [
        d.execute(lockCollection(collectionId)),
        d.execute(addMembers(collectionId, [editionId])),
      ]),
    ]);

    // A publisher name no house knows yet is decided when it is safe
    await autoResolveEditions([editionId]);
    invalidate(
      CACHE_TAGS.works,
      CACHE_TAGS.series,
      CACHE_TAGS.editions,
      CACHE_TAGS.authors,
      ...(collectionIds.length ? [CACHE_TAGS.collections] : []),
    );
    return {
      ok: true,
      workId,
      slug: existing?.slug ?? work!.slug,
      editionId,
      coverUnavailable: edition.coverUnavailable,
    };
  } catch (err) {
    await edition?.discardCover();
    console.error("createBookFromWizard: the write failed, nothing was saved", err);
    return { ok: false, error: "Could not add the book. Nothing was saved." };
  }
}
