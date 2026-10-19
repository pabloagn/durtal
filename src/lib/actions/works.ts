"use server";

import { ExpectedActionError } from "@/lib/actions/expected-error";

import {
  bookCondition,
  requireBookWork,
  bookResult,
} from "@/lib/catalogue/book-boundary";

import { bookAuthorQueries } from "@/lib/catalogue/book-credits";
import { curationQueries } from "@/lib/catalogue/curation-store";
import { planBookWork, workSubjectQueries } from "@/lib/catalogue/book-store";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { ebooksForWork, lockReaderBindings, lockReaderNotes, withReaderWriteRetry } from "@/lib/reading/reader-write-locks";
import { workSeriesPlan, resultRows } from "@/lib/series/work-series";
import { deleteUnusedObjects, workObjects } from "@/lib/s3/cleanup";
import {
  works,
  workAuthors,
  editions,
  authors,
  comments,
  activityEvents,
  galleryLayouts,
  media,
  instanceStatusHistory,
} from "@/lib/db/schema";
import {
  sql,
  eq,
  desc,
  asc,
  count,
  and,
  inArray,
} from "drizzle-orm";
import { z } from "zod";
import {
  createWorkSchema,
  updateWorkSchema,
  type CreateWorkInput,
  type UpdateWorkInput,
} from "@/lib/validations";
import { bookLinksSchema } from "@/lib/validations/book-links";
import { parseId } from "@/lib/validations/helpers";
import { refreshWorkSlug } from "@/lib/works/slug";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { recordActivity } from "@/lib/activity/record";
import { authorOrderedBookIds } from "@/lib/actions/utils/author-ordered-books";
import { alphabeticalWorkIds } from "@/lib/actions/utils/alphabetical-works";
import { compareWorks } from "@/lib/utils/title-order";
import { posterTone, readingExtras, workCardExtras, workCardWith } from "@/lib/actions/utils/work-card-query";
import { libraryStatsReads } from "@/lib/actions/utils/library-stats";
import { markedWorkCards, markedWorkIds } from "@/lib/catalogue/marked-works";
import type { WorkMarkKey } from "@/lib/constants/marks";
import { normalizeSearchText } from "@/lib/utils/search-text";
import type { SQL } from "drizzle-orm";
import { readingFilterConditions } from "@/lib/reading/filter-conditions";
import { bookFilterConditions } from "@/lib/library/filter-conditions";
import { workSearchCondition } from "@/lib/library/search-condition";
import type { BookFilterParams } from "@/lib/library/filter-params";
import { lastReadAtSql } from "@/lib/reading/summary";
import type { ReadingFilterParams } from "@/lib/reading/filter-params";
import { queueNewBookEnrichment } from "@/lib/enrichment/queue";
import { assertSql } from "@/lib/harmonization/store";
import { bookEditFingerprint, STALE_BOOK } from "@/lib/catalogue/book-fingerprint";
import { readFingerprint } from "@/lib/catalogue/work-store";
import { fingerprintSchema } from "@/lib/validations/records";
import { KEPT_ORDER_STATUSES, keptOrderRefusalFor, workDeleteSummary } from "@/lib/catalogue/delete-summary";

export type WorkFilters = ReadingFilterParams &
  BookFilterParams & {
    isRare?: boolean;
    isPoison?: boolean;
  };

/**
 * The where clause of the library list and its count, so both apply the same
 * search and filters. Null when a filter can match no book.
 */
async function buildWorkConditions(
  search: string | undefined,
  filters: WorkFilters | undefined,
): Promise<SQL | undefined> {
  const conditions = [bookCondition];
  if (search) {
    conditions.push(workSearchCondition(search));
  }
  if (filters?.isRare !== undefined) {
    conditions.push(eq(works.isRare, filters.isRare));
  }
  if (filters?.isPoison !== undefined) {
    conditions.push(eq(works.isPoison, filters.isPoison));
  }
  // Marks, publishers, copies, languages, years, taxonomy, colour (SLN-405)
  conditions.push(...bookFilterConditions(filters));
  // Status, reading state, holding, read in, re-read (SLN-449)
  conditions.push(...readingFilterConditions(works.id, filters));
  return and(...conditions);
}

export type WorksQuery = {
  search?: string;
  limit?: number;
  offset?: number;
  sort?:
    | "title"
    | "recent"
    | "year"
    | "rating"
    | "authorFirstName"
    | "authorLastName"
    | "lastRead"
    | "queue";
  order?: "asc" | "desc";
  filters?: WorkFilters;
};

export async function getWorks(opts?: WorksQuery) {
  const [results] = await getWorksWith(opts, async () => undefined);
  return results;
}

/**
 * The library's page of works, with a read of their ids alongside. When the
 * sort picks the page's ids first (title, author), that read runs with the
 * page's details instead of after them: one round trip fewer (SLN-828).
 */
export async function getWorksWith<T>(
  opts: WorksQuery | undefined,
  alongside: (workIds: string[]) => Promise<T>,
) {
  const {
    search,
    limit = 50,
    offset = 0,
    sort = "title",
    order,
    filters,
  } = opts ?? {};

  // Default sort directions per sort type
  const defaultOrders: Record<string, "asc" | "desc"> = {
    title: "asc",
    recent: "desc",
    year: "desc",
    rating: "desc",
    authorFirstName: "asc",
    authorLastName: "asc",
    lastRead: "desc",
    queue: "asc",
  };
  const resolvedOrder = order ?? defaultOrders[sort] ?? "asc";

  const orderFn = resolvedOrder === "asc" ? asc : desc;

  // Title and author order use lightweight IDs sorted before pagination.
  const orderBy = {
    title: orderFn(works.title),
    recent: orderFn(works.createdAt),
    year: orderFn(works.originalYear),
    // Unrated works last in either direction
    rating: resolvedOrder === "asc" ? sql`${works.rating} asc nulls last` : sql`${works.rating} desc nulls last`,
    authorFirstName: orderFn(works.createdAt), // page membership is selected below
    authorLastName: orderFn(works.createdAt), // page membership is selected below
    // The later of the last finish and the last progress; never read last either way
    lastRead: resolvedOrder === "asc" ? sql`${lastReadAtSql(works.id)} asc nulls last` : sql`${lastReadAtSql(works.id)} desc nulls last`,
    // Up next order (SLN-452); books not queued last either way
    queue: sql`(select q.position from reading_queue q where q.work_id = ${works.id}) ${sql.raw(resolvedOrder === "asc" ? "asc" : "desc")} nulls last`,
  }[sort];

  const where = await buildWorkConditions(search, filters);

  const pageIds =
    sort === "title"
      ? await alphabeticalWorkIds(where, limit, offset, resolvedOrder)
      : sort === "authorFirstName" || sort === "authorLastName"
        ? await authorOrderedBookIds(where, sort, resolvedOrder, limit, offset)
        : undefined;
  const details = db.query.works.findMany({
    where: pageIds ? inArray(works.id, pageIds) : where,
    orderBy: [...(Array.isArray(orderBy) ? orderBy : [orderBy]), asc(works.id)],
    limit,
    offset: pageIds ? 0 : offset,
    extras: readingExtras,
    with: {
      workAuthors: {
        with: { author: true },
        orderBy: asc(workAuthors.sortOrder),
      },
      editions: {
        columns: {
          id: true,
          coverS3Key: true,
          thumbnailS3Key: true,
          publicationYear: true,
          language: true,
          updatedAt: true,
        },
        // The card shows the first edition: the order `coverColorSql` reads
        orderBy: [asc(editions.createdAt), asc(editions.id)],
        with: {
          instances: {
            columns: { id: true },
          },
        },
      },
      media: {
        columns: {
          s3Key: true,
          thumbnailS3Key: true,
          type: true,
          isActive: true,
          cropX: true,
          cropY: true,
          cropZoom: true,
          brightness: true,
          contrast: true,
          createdAt: true,
        },
        extras: posterTone,
      },
    },
  });
  const [results, extra] = pageIds?.length === 0
    ? [[] as Awaited<typeof details>, await alongside([])] as const
    : pageIds
    ? await Promise.all([details, alongside(pageIds)])
    : await details.then(async (rows) => [rows, await alongside(rows.map((row) => row.id))] as const);

  if (sort === "title") {
    results.sort((a, b) => compareWorks(a, b, resolvedOrder));
  }

  if (sort === "authorFirstName" || sort === "authorLastName") {
    const positions = new Map(pageIds!.map((id, index) => [id, index]));
    results.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
  }

  return [results, extra] as const;
}

export async function getWorkCount(search?: string, filters?: WorkFilters) {
  const where = await buildWorkConditions(search, filters);

  const [result] = await db.select({ count: count() }).from(works).where(where);
  return result.count;
}

/** Relations of a book's detail page, loaded by id or by slug. */
const workDetailWith = {
  workAuthors: {
    with: { author: true },
    orderBy: asc(workAuthors.sortOrder),
  },
  workSubjects: {
    with: { subject: true },
  },
  editions: {
    // The original-language editions first, then the newest, then by title
    // (SLN-1132); the id breaks ties, so the Editions section and the quotes'
    // edition groups (SLN-480) agree
    orderBy: [
      sql`(${editions.language} is distinct from (select w.original_language from works w where w.id = ${editions.workId}))`,
      sql`${editions.publicationYear} desc nulls last`,
      asc(editions.title),
      asc(editions.id),
    ] as SQL[],
    with: {
      publisherLinks: { with: { publisher: true } },
      instances: {
        with: {
          location: true,
          subLocation: true,
          // The loans that ended, for the copy's loan history (SLN-1125)
          statusHistory: {
            columns: { fromStatus: true, toStatus: true, changedAt: true, notes: true },
            where: eq(instanceStatusHistory.fromStatus, "lent_out"),
          },
        },
      },
      contributors: {
        with: { author: true },
      },
      editionGenres: {
        with: { genre: true },
      },
      editionTags: {
        with: { tag: true },
      },
    },
  },
  media: true,
  workType: true,
  series: true,
  workRecommenders: { with: { recommender: true } },
  workCategories: { with: { category: true } },
  workThemes: { with: { theme: true } },
  workLiteraryMovements: { with: { literaryMovement: true } },
  workArtTypes: { with: { artType: true } },
  workArtMovements: { with: { artMovement: true } },
  workKeywords: { with: { keyword: true } },
  workAttributes: { with: { attribute: true } },
} as const;

export async function getWork(id: string) {
  const result = await db.query.works.findFirst({
    where: and(bookCondition, eq(works.id, id)),
    with: workDetailWith,
  });

  return bookResult(result);
}

/** What a book's Edit work dialog sends back with its save (SLN-1243) */
export async function getBookEditFingerprint(id: string) {
  return readFingerprint(bookEditFingerprint(z.string().uuid().parse(id)));
}

export async function getWorkBySlug(slug: string) {
  const result = await db.query.works.findFirst({
    where: and(bookCondition, eq(works.slug, slug)),
    with: workDetailWith,
  });

  return bookResult(result);
}

/** What the duplicate panel shows: names, counts and the card's cover */
const duplicateWith = {
  workAuthors: {
    with: { author: true },
    orderBy: asc(workAuthors.sortOrder),
  },
  editions: {
    columns: { id: true, coverS3Key: true, thumbnailS3Key: true },
    // The first edition, as on the work's library card
    orderBy: [asc(editions.createdAt), asc(editions.id)] as SQL[],
    with: { instances: { columns: { id: true } } },
  },
  media: {
    where: and(eq(media.type, "poster"), eq(media.isActive, true)),
    columns: {
      s3Key: true,
      thumbnailS3Key: true,
      cropX: true,
      cropY: true,
      cropZoom: true,
      brightness: true,
      contrast: true,
    },
    limit: 1,
  },
} as const;

/**
 * Check if a work already exists by ISBN or title+author.
 * Used by the add-book wizard to prevent duplicates.
 */
export async function findDuplicateWork(opts: {
  isbn13?: string;
  title: string;
  authorName: string;
}) {
  // First try exact ISBN match
  if (opts.isbn13) {
    const byIsbn = await db.query.editions.findFirst({
      where: eq(editions.isbn13, opts.isbn13),
      with: { work: { with: duplicateWith } },
    });
    if (byIsbn?.work) return { ...byIsbn.work, matchedBy: "isbn" as const };
  }

  // Same title, ignoring accents, case and punctuation ("Agua Viva" and
  // "Água Viva"), then an author with the same name words (SLN-287)
  const candidates = await db.query.works.findMany({
    where: and(
      bookCondition,
      sql`search_normalize(${works.title}) = search_normalize(${opts.title.trim()})`,
    ),
    with: duplicateWith,
    limit: 5,
  });

  // An author matches when the words of one name are all in the other:
  // "Lem", "Stanislaw Lem" and "Stanisław Lem"; "Arkady Strugatsky" and
  // "Arkady and Boris Strugatsky"
  const words = (name: string) =>
    new Set(normalizeSearchText(name).split(" ").filter(Boolean));
  const wanted = words(opts.authorName);
  const within = (a: Set<string>, b: Set<string>) =>
    a.size > 0 && [...a].every((w) => b.has(w));
  const match = candidates.find((w) =>
    w.workAuthors.some((wa) => {
      const have = words(wa.author.name);
      return within(wanted, have) || within(have, wanted);
    }),
  );

  return match ? { ...match, matchedBy: "title_author" as const } : null;
}

export async function createWork(input: CreateWorkInput) {
  const parsed = createWorkSchema.parse(input);
  // The id and slug are known before the write, so the work, its authors,
  // subjects, recommendations and activity go out as one transaction: a
  // failure leaves no half-created book.
  const primaryAuthor = await db.query.authors.findFirst({
    where: eq(authors.id, parsed.authorIds[0].authorId),
    columns: { name: true },
  });
  const plan = await planBookWork(parsed, primaryAuthor?.name ?? "unknown");
  await atomic(plan.queries);
  // Book enrichment (SLN-464): its identity job, after the save
  await queueNewBookEnrichment(plan.id);
  invalidate(CACHE_TAGS.works, CACHE_TAGS.series);
  return (await db.query.works.findFirst({ where: eq(works.id, plan.id) }))!;
}

/**
 * `fingerprint`: what Edit work read with the page (`bookEditFingerprint`).
 * Given, a save over a change made since then is refused (SLN-1243).
 */
export async function updateWork(id: string, input: UpdateWorkInput, fingerprint?: string) {
  parseId(id);
  const expected = fingerprint === undefined ? null : fingerprintSchema.parse(fingerprint);
  const {
    authorIds,
    subjectIds,
    recommenderIds,
    notes,
    rating,
    goodreadsUrl,
    storygraphUrl,
    ...rest
  } = updateWorkSchema.parse(input);
  // Personal curation goes through the shared path that every domain uses
  const curation = { notes, rating, recommenderIds };
  // Book links are checked here too: only https pages on the site's own domain.
  const links = bookLinksSchema.parse({ goodreadsUrl, storygraphUrl });
  const seriesPlan = workSeriesPlan(rest);
  const workData = {
    ...rest,
    ...seriesPlan.values,
    ...(links.goodreadsUrl !== undefined
      ? { goodreadsUrl: links.goodreadsUrl }
      : {}),
    ...(links.storygraphUrl !== undefined
      ? { storygraphUrl: links.storygraphUrl }
      : {}),
  };

  // Snapshot current state for activity diffing
  const prev = await db.query.works.findFirst({
    where: and(bookCondition, eq(works.id, id)),
    columns: {
      title: true,
      originalYear: true,
      originalLanguage: true,
      catalogueStatus: true,
      acquisitionPriority: true,
      rating: true,
      seriesId: true,
    },
    with: {
      workAuthors: {
        columns: { authorId: true },
        with: { author: { columns: { id: true, name: true } } },
        orderBy: asc(workAuthors.sortOrder),
      },
    },
  });

  if (!prev) throw new ExpectedActionError("Work not found");
  if (expected && (await readFingerprint(bookEditFingerprint(id))) !== expected)
    throw new ExpectedActionError(STALE_BOOK);

  // One transaction: the work's fields, its curation, authors and subjects
  // are all saved, or none is.
  let updateAt = -1;
  const results = await atomic((d) => {
    const queries: unknown[] = [];
    // Checked again with the work locked: two saves of one view never both land
    if (expected)
      queries.push(
        d.execute(sql`select id from works where id=${id}::uuid for update`),
        d.execute(assertSql(sql`coalesce(${bookEditFingerprint(id)}=${expected},false)`, STALE_BOOK)),
      );
    if (Object.keys(workData).length > 0) {
      queries.push(...seriesPlan.queries(d));
      updateAt = queries.length;
      queries.push(
        d
          .update(works)
          .set({ ...workData, updatedAt: new Date() })
          .where(and(bookCondition, eq(works.id, id)))
          .returning({ seriesId: works.seriesId }),
      );
    }
    queries.push(
      ...curationQueries(d, { id, kind: "book" }, curation),
      ...(authorIds ? bookAuthorQueries(d, id, authorIds) : []),
      ...workSubjectQueries(d, id, subjectIds),
    );
    return queries;
  });
  if (updateAt >= 0 && "seriesId" in workData)
    workData.seriesId =
      resultRows<{ seriesId: string | null }>(results[updateAt])[0]
        ?.seriesId ?? null;
  // Activity compares the rating like the other work fields
  const changed = rating !== undefined ? { ...workData, rating } : workData;

  // The slug follows the title and primary author. The check reads the work
  // after the write above, so it compares the slug with the new values.
  if (workData.title !== undefined || authorIds !== undefined) {
    const change = await refreshWorkSlug(id);
    if (change) {
      recordWorkDiffs(id, prev, changed, authorIds);
      invalidate(CACHE_TAGS.works, CACHE_TAGS.series);
      return { id, slug: change.to };
    }
  }

  recordWorkDiffs(id, prev, changed, authorIds);
  invalidate(CACHE_TAGS.works, CACHE_TAGS.series);
  return { id };
}

/** Emit per-field activity events by diffing previous state against incoming input. */
function recordWorkDiffs(
  id: string,
  prev:
    | {
        title: string;
        originalYear: number | null;
        originalLanguage: string | null;
        catalogueStatus: string | null;
        acquisitionPriority: string | null;
        rating: number | null;
        seriesId: string | null;
        workAuthors: {
          authorId: string;
          author: { id: string; name: string };
        }[];
      }
    | undefined,
  workData: Record<string, unknown>,
  authorIds?: { authorId: string; role?: string }[],
) {
  if (!prev) return;

  const fieldMap: [string, string][] = [
    ["title", "work.title_changed"],
    ["originalYear", "work.year_changed"],
    ["originalLanguage", "work.language_changed"],
    ["catalogueStatus", "work.catalogue_status_changed"],
    ["acquisitionPriority", "work.acquisition_priority_changed"],
    ["rating", "work.rating_changed"],
  ];

  for (const [field, eventKey] of fieldMap) {
    if (
      field in workData &&
      workData[field] !== (prev as Record<string, unknown>)[field]
    ) {
      recordActivity("work", id, eventKey, {
        oldValue: (prev as Record<string, unknown>)[field] as
          | string
          | number
          | null,
        newValue: workData[field] as string | number | null,
      });
    }
  }

  if ("seriesId" in workData && workData.seriesId !== prev.seriesId) {
    recordActivity("work", id, "work.series_changed", {
      oldValue: prev.seriesId,
      newValue: workData.seriesId as string | null,
    });
  }

  if (authorIds) {
    const oldIds = new Set(prev.workAuthors.map((wa) => wa.authorId));
    const newIds = new Set(authorIds.map((a) => a.authorId));
    for (const a of authorIds) {
      if (!oldIds.has(a.authorId)) {
        recordActivity("work", id, "work.author_added", {
          targetId: a.authorId,
        });
      }
    }
    for (const wa of prev.workAuthors) {
      if (!newIds.has(wa.authorId)) {
        recordActivity("work", id, "work.author_removed", {
          targetId: wa.authorId,
          targetName: wa.author.name,
        });
      }
    }
  }
}

export async function deleteWork(id: string) {
  return withReaderWriteRetry(() => deleteWorkOnce(id));
}

/** What deleting these books takes with them, for the delete dialogs (SLN-1112) */
export async function getWorkDeleteSummary(ids: string[]) {
  return workDeleteSummary(z.array(z.string().uuid()).max(5000).parse(ids));
}

async function deleteWorkOnce(id: string) {
  await requireBookWork(id);
  // An order with the book in hand is its acquisition record: deleteOrder
  // refuses it, so the book's delete does too rather than take it (SLN-1112)
  const refusal = await keptOrderRefusalFor(sql`array[${id}::uuid]`);
  if (refusal) throw new ExpectedActionError(refusal);
  // Read the file keys first: the cascade removes the rows that name them.
  const stored = await workObjects(id);

  // Polymorphic records have no FK cascade; they go in the same write.
  const results = await atomic((d) => [
    lockReaderBindings(d, ebooksForWork(id), sql`select id from reading_notes where work_id=${id}::uuid`),
    lockReaderNotes(d, sql`select id from reading_notes where work_id=${id}::uuid`),
    // A status change waits on its order's row, a new order on the book's;
    // orders first, as a status change locks its order before the book
    d.execute(sql`select id from orders where work_id=${id}::uuid for update`),
    d.execute(sql`select id from works where id=${id}::uuid for update`),
    d.execute(
      assertSql(
        sql`not exists (select 1 from orders where work_id=${id}::uuid and status::text in ${KEPT_ORDER_STATUSES})`,
        "This book's order now has the book in hand. Mark the order Returned before deleting the book.",
      ),
    ),
    d
      .delete(comments)
      .where(and(eq(comments.entityType, "work"), eq(comments.entityId, id))),
    d
      .delete(activityEvents)
      .where(
        and(
          eq(activityEvents.entityType, "work"),
          eq(activityEvents.entityId, id),
        ),
      ),
    d
      .delete(galleryLayouts)
      .where(
        and(
          eq(galleryLayouts.entityType, "work"),
          eq(galleryLayouts.entityId, id),
        ),
      ),
    d
      .delete(works)
      .where(and(bookCondition, eq(works.id, id)))
      .returning({ id: works.id }),
  ]);
  invalidate(CACHE_TAGS.works, CACHE_TAGS.series, CACHE_TAGS.media);

  const deleted = (results.at(-1) as { id: string }[]).length > 0;
  const cleanupPending =
    deleted && (await deleteUnusedObjects(stored, `work ${id}`));
  return { id, cleanupPending };
}

export async function getWorksByAuthorId(
  authorId: string,
  excludeWorkId?: string,
  limit = 12,
) {
  // Get work IDs for this author
  const authorWorks = await db.query.workAuthors.findMany({
    where: and(
      eq(workAuthors.authorId, authorId),
      inArray(workAuthors.role, ["author", "co_author"]),
    ),
    columns: { workId: true },
  });

  const workIds = authorWorks
    .map((wa) => wa.workId)
    .filter((id) => id !== excludeWorkId);

  if (workIds.length === 0) return [];

  const ids = await alphabeticalWorkIds(inArray(works.id, workIds), limit);
  if (!ids.length) return [];
  const results = await db.query.works.findMany({
    where: inArray(works.id, ids),
    extras: workCardExtras,
    with: workCardWith,
  });
  return results.sort(compareWorks);
}

/** Other works with a mark, alphabetically, for the book page's mark rows. */
export async function getWorksWithMark(
  mark: WorkMarkKey,
  excludeWorkId: string,
  limit = 12,
) {
  return markedWorkCards(await markedWorkIds(mark, excludeWorkId, limit));
}

/** Dashboard stats; `shelf` is how many books each shelf takes (the API keeps 8) */
export async function getLibraryStats({ shelf = 8 }: { shelf?: number } = {}) {
  const { library, wanted } = libraryStatsReads({ shelf });
  const [{ recentAuthors, ...stats }, wantedWorks] = await Promise.all([library, wanted]);
  // The API's order: the shelves, then the people
  return { ...stats, wantedWorks, recentAuthors };
}
