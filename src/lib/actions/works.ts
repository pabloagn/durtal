"use server";

import { cache } from "react";
import { bookPersonCondition } from "@/lib/catalogue/person-boundary";

import {
  bookCondition,
  requireBookWork,
  bookResult,
} from "@/lib/catalogue/book-boundary";

import { publisherWorkCondition } from "@/lib/publishers/conditions";
import { bookAuthorQueries } from "@/lib/catalogue/book-credits";
import { curationQueries } from "@/lib/catalogue/curation-store";
import { planBookWork, workSubjectQueries } from "@/lib/catalogue/book-store";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { workSeriesPlan, resultRows } from "@/lib/series/work-series";
import { deleteUnusedObjects, workObjects } from "@/lib/s3/cleanup";
import {
  works,
  workAuthors,
  editions,
  editionPublishers,
  publishingHouses,
  instances,
  authors,
  media,
  comments,
  activityEvents,
  galleryLayouts,
} from "@/lib/db/schema";
import {
  sql,
  eq,
  desc,
  asc,
  ilike,
  count,
  and,
  or,
  inArray,
  gte,
  isNotNull,
  notInArray,
  ne,
} from "drizzle-orm";
import { containsPattern } from "@/lib/utils/like";
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
import { authorSearchCondition } from "@/lib/actions/utils/author-search";
import { authorOrderedBookIds } from "@/lib/actions/utils/author-ordered-books";
import { alphabeticalWorkIds } from "@/lib/actions/utils/alphabetical-works";
import { compareWorks } from "@/lib/utils/title-order";
import { posterTone, workCardExtras, workCardWith } from "@/lib/actions/utils/work-card-query";
import { markColumn, marksCondition } from "@/lib/actions/utils/work-marks";
import { WORK_MARKS, type WorkMarkKey } from "@/lib/constants/marks";
import { normalizeSearchText } from "@/lib/utils/search-text";
import type { AnyColumn, SQL } from "drizzle-orm";
import { countryDisplayName } from "@/lib/utils/labels";
import { readingFilterConditions } from "@/lib/reading/filter-conditions";
import {
  lastFinishedOnSql,
  lastFinishedPrecisionSql,
  lastReadAtSql,
  readCountSql,
} from "@/lib/reading/summary";
import type { ReadingFilterParams } from "@/lib/reading/filter-params";

type AcquisitionPriority =
  (typeof works.acquisitionPriority.enumValues)[number];

/**
 * Build a search condition that matches works by title, author, ISBN,
 * publisher, or series name. Detects ISBN-shaped queries and prioritises
 * edition-level ISBN lookup. Memoised per request, so the list and the
 * count on one page run the related-table lookups once.
 */
const buildSearchCondition = cache(async (search: string) => {
  const stripped = search.replace(/[-\s]/g, "");
  const isIsbn = /^\d{10,13}$/.test(stripped);

  // Collect work IDs that match via related tables
  const relatedWorkIds = new Set<string>();

  // 1. ISBN lookup (always, not just when the query "looks like" an ISBN —
  //    this lets partial-ISBN or hyphenated-ISBN queries still match)
  if (isIsbn || /\d{4,}/.test(stripped)) {
    const target = isIsbn ? stripped : search.trim();
    const isbnEditions = await db
      .select({ workId: editions.workId })
      .from(editions)
      .where(
        or(
          eq(editions.isbn13, target),
          eq(editions.isbn10, target),
          ilike(editions.isbn13, containsPattern(target)),
          ilike(editions.isbn10, containsPattern(target)),
        ),
      );
    for (const r of isbnEditions) relatedWorkIds.add(r.workId);

    // Pure ISBN query — don't bother with title/author text matching
    if (isIsbn) {
      return relatedWorkIds.size > 0
        ? inArray(works.id, [...relatedWorkIds])
        : eq(works.id, "00000000-0000-0000-0000-000000000000"); // no match
    }
  }

  // 2. Author name match (accent/case-insensitive, any word order; no typo
  //    matching here, so book results stay precise)
  const authorCondition = authorSearchCondition(search, { fuzzy: false });
  if (authorCondition) {
    const authorMatches = await db
      .select({ workId: workAuthors.workId })
      .from(workAuthors)
      .innerJoin(authors, eq(workAuthors.authorId, authors.id))
      .where(authorCondition);
    for (const r of authorMatches) relatedWorkIds.add(r.workId);
  }

  // 3. Publisher match (via editions)
  const publisherMatches = await db
    .select({ workId: editions.workId })
    .from(editions)
    .where(ilike(editions.publisher, containsPattern(search)));
  for (const r of publisherMatches) relatedWorkIds.add(r.workId);
  const identityMatches = await db
    .selectDistinct({ workId: editions.workId })
    .from(editions)
    .innerJoin(editionPublishers, eq(editionPublishers.editionId, editions.id))
    .innerJoin(
      publishingHouses,
      eq(publishingHouses.id, editionPublishers.publisherId),
    )
    .where(
      sql`strpos(lower(${publishingHouses.name}),lower(${search})) > 0 or exists (select 1 from publisher_aliases a where a.publisher_id = ${publishingHouses.id} and strpos(lower(a.name),lower(${search})) > 0)`,
    );
  for (const r of identityMatches) relatedWorkIds.add(r.workId);

  // Build OR condition: title match OR series name match OR related-table matches
  const orConditions = [
    ilike(works.title, containsPattern(search)),
    ilike(works.seriesName, containsPattern(search)),
    sql`exists (select 1 from series where series.id = ${works.seriesId} and series.title ilike ${containsPattern(search)})`,
  ];
  if (relatedWorkIds.size > 0) {
    orConditions.push(inArray(works.id, [...relatedWorkIds]));
  }
  return or(...orConditions)!;
});

export type WorkFilters = ReadingFilterParams & {
  isRare?: boolean;
  isPoison?: boolean;
  marks?: WorkMarkKey[];
  publisherIds?: string[];
  acquisitionPriority?: string[];
  minRating?: number;
  locationId?: string;
  hasPoster?: boolean;
};

/** The library cards' and the API's reading data, one correlated subquery each over the root work (SLN-449) */
const readingExtras = (work: { id: AnyColumn }) => ({
  ...workCardExtras(work),
  timesRead: readCountSql(work.id).as("times_read"),
  lastFinishedOn: lastFinishedOnSql(work.id).as("last_finished_on"),
  lastFinishedPrecision: lastFinishedPrecisionSql(work.id).as("last_finished_precision"),
});

/**
 * The where clause of the library list and its count, so both apply the same
 * search and filters. Null when a filter can match no book.
 */
async function buildWorkConditions(
  search: string | undefined,
  filters: WorkFilters | undefined,
): Promise<SQL | undefined | null> {
  const conditions = [bookCondition];
  if (search) {
    conditions.push(await buildSearchCondition(search));
  }
  if (filters?.publisherIds?.length)
    conditions.push(publisherWorkCondition(filters.publisherIds));
  if (filters?.isRare !== undefined) {
    conditions.push(eq(works.isRare, filters.isRare));
  }
  if (filters?.isPoison !== undefined) {
    conditions.push(eq(works.isPoison, filters.isPoison));
  }
  const marks = marksCondition(filters?.marks ?? []);
  if (marks) conditions.push(marks);
  // Status, reading state, holding, read in, re-read (SLN-449)
  conditions.push(...readingFilterConditions(works.id, filters));
  if (filters?.acquisitionPriority?.length) {
    conditions.push(
      inArray(
        works.acquisitionPriority,
        filters.acquisitionPriority as AcquisitionPriority[],
      ),
    );
  }
  if (filters?.minRating) {
    conditions.push(gte(works.rating, filters.minRating));
  }
  if (filters?.locationId) {
    const matchingInstances = await db
      .select({ workId: editions.workId })
      .from(instances)
      .innerJoin(editions, eq(instances.editionId, editions.id))
      .where(eq(instances.locationId, filters.locationId));
    const workIds = [...new Set(matchingInstances.map((r) => r.workId))];
    if (workIds.length === 0) return null;
    conditions.push(inArray(works.id, workIds));
  }
  if (filters?.hasPoster !== undefined) {
    const posterRows = await db
      .select({ workId: media.workId })
      .from(media)
      .where(
        and(
          eq(media.type, "poster"),
          eq(media.isActive, true),
          isNotNull(media.workId),
        ),
      );
    const posterWorkIds = [...new Set(posterRows.map((r) => r.workId!))];
    if (filters.hasPoster) {
      // Only works WITH a poster
      if (posterWorkIds.length === 0) return null;
      conditions.push(inArray(works.id, posterWorkIds));
    } else if (posterWorkIds.length > 0) {
      // Only works WITHOUT a poster; when no work has one, all works match
      conditions.push(notInArray(works.id, posterWorkIds));
    }
  }
  return and(...conditions);
}

export async function getWorks(opts?: {
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
}) {
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
    // Up Next order (SLN-452); books not queued last either way
    queue: sql`(select q.position from reading_queue q where q.work_id = ${works.id}) ${sql.raw(resolvedOrder === "asc" ? "asc" : "desc")} nulls last`,
  }[sort];

  const where = await buildWorkConditions(search, filters);
  if (where === null) return [];

  const pageIds =
    sort === "title"
      ? await alphabeticalWorkIds(where, limit, offset, resolvedOrder)
      : sort === "authorFirstName" || sort === "authorLastName"
        ? await authorOrderedBookIds(where, sort, resolvedOrder, limit, offset)
        : undefined;
  if (pageIds?.length === 0) return [];

  const results = await db.query.works.findMany({
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

  if (sort === "title") {
    results.sort((a, b) => compareWorks(a, b, resolvedOrder));
  }

  if (sort === "authorFirstName" || sort === "authorLastName") {
    const positions = new Map(pageIds!.map((id, index) => [id, index]));
    results.sort((a, b) => positions.get(a.id)! - positions.get(b.id)!);
  }

  return results;
}

export async function getWorkCount(search?: string, filters?: WorkFilters) {
  const where = await buildWorkConditions(search, filters);
  if (where === null) return 0;

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
    orderBy: desc(editions.publicationYear),
    with: {
      publisherLinks: { with: { publisher: true } },
      instances: {
        with: {
          location: true,
          subLocation: true,
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

export async function getWorkBySlug(slug: string) {
  const result = await db.query.works.findFirst({
    where: and(bookCondition, eq(works.slug, slug)),
    with: workDetailWith,
  });

  return bookResult(result);
}

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
      with: {
        work: {
          with: {
            workAuthors: {
              with: { author: true },
              orderBy: asc(workAuthors.sortOrder),
            },
            editions: {
              columns: { id: true },
              with: { instances: { columns: { id: true } } },
            },
          },
        },
      },
    });
    if (byIsbn?.work) return byIsbn.work;
  }

  // Same title, ignoring accents, case and punctuation ("Agua Viva" and
  // "Água Viva"), then an author with the same name words (SLN-287)
  const candidates = await db.query.works.findMany({
    where: and(
      bookCondition,
      sql`search_normalize(${works.title}) = search_normalize(${opts.title.trim()})`,
    ),
    with: {
      workAuthors: {
        with: { author: true },
        orderBy: asc(workAuthors.sortOrder),
      },
      editions: {
        columns: { id: true },
        with: { instances: { columns: { id: true } } },
      },
    },
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

  return match ?? null;
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
  invalidate(CACHE_TAGS.works, CACHE_TAGS.series);
  return (await db.query.works.findFirst({ where: eq(works.id, plan.id) }))!;
}

export async function updateWork(id: string, input: UpdateWorkInput) {
  parseId(id);
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

  if (!prev) throw new Error("Work not found");

  // One transaction: the work's fields, its curation, authors and subjects
  // are all saved, or none is.
  let updateAt = -1;
  const results = await atomic((d) => {
    const queries: unknown[] = [];
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
  await requireBookWork(id);
  // Read the file keys first: the cascade removes the rows that name them.
  const stored = await workObjects(id);

  // Polymorphic records have no FK cascade; they go in the same write.
  const results = await atomic((d) => [
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

  const deleted = (results[3] as { id: string }[]).length > 0;
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
    where: eq(workAuthors.authorId, authorId),
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
  const key = z.enum(WORK_MARKS.map((m) => m.key)).parse(mark);
  const id = z.uuid().parse(excludeWorkId);
  z.number().int().min(1).max(50).parse(limit);
  const ids = await alphabeticalWorkIds(
    and(eq(markColumn(key), true), ne(works.id, id)),
    limit,
  );
  if (!ids.length) return [];
  const results = await db.query.works.findMany({
    where: inArray(works.id, ids),
    extras: workCardExtras,
    with: workCardWith,
  });
  return results.sort(compareWorks);
}

/** Dashboard stats */
export async function getLibraryStats() {
  const worksWith = {
    workAuthors: {
      with: { author: true },
      orderBy: asc(workAuthors.sortOrder),
      limit: 1,
    },
    editions: {
      columns: {
        id: true,
        thumbnailS3Key: true,
        publicationYear: true,
        language: true,
      },
      limit: 1,
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
      },
      extras: posterTone,
    },
  } as const;

  const wantedIds = await alphabeticalWorkIds(
    inArray(works.catalogueStatus, ["wanted", "shortlisted"]),
    8,
  );
  const [
    [workCount],
    [editionCount],
    [instanceCount],
    [authorCount],
    recentWorks,
    topRatedWorks,
    wantedWorks,
    recentWorksForAuthors,
  ] = await Promise.all([
    db.select({ count: count() }).from(works).where(bookCondition),
    db.select({ count: count() }).from(editions),
    db.select({ count: count() }).from(instances),
    db.select({ count: count() }).from(authors).where(bookPersonCondition),
    // Recent additions
    db.query.works.findMany({
      where: bookCondition,
      orderBy: desc(works.createdAt),
      limit: 8,
      extras: readingExtras,
      with: worksWith,
    }),
    // Top rated
    db.query.works.findMany({
      where: and(bookCondition, isNotNull(works.rating)),
      orderBy: [sql`${works.rating} desc nulls last`, desc(works.createdAt)],
      limit: 8,
      extras: readingExtras,
      with: worksWith,
    }),
    // Wanted / shortlisted
    db.query.works.findMany({
      where: inArray(works.id, wantedIds),
      with: worksWith,
    }),
    // For recent authors: get more works so we can extract unique authors
    db.query.works.findMany({
      where: bookCondition,
      orderBy: desc(works.createdAt),
      limit: 40,
      with: {
        workAuthors: {
          with: {
            author: {
              with: {
                country: { columns: { name: true, alpha2: true } },
                workAuthors: { columns: { workId: true } },
                media: {
                  columns: {
                    s3Key: true,
                    thumbnailS3Key: true,
                    type: true,
                    isActive: true,
                  },
                  extras: posterTone,
                },
              },
            },
          },
          orderBy: asc(workAuthors.sortOrder),
          limit: 1,
        },
      },
    }),
  ]);

  // De-duplicate authors from recent works, preserving recency order
  const seenAuthorIds = new Set<string>();
  const recentAuthors: Array<{
    id: string;
    slug: string | null;
    name: string;
    photoS3Key: string | null;
    photoTone: string | null;
    nationality: string | null;
    birthYear: number | null;
    deathYear: number | null;
    worksCount: number;
  }> = [];
  for (const work of recentWorksForAuthors) {
    const author = work.workAuthors[0]?.author;
    if (author && !seenAuthorIds.has(author.id)) {
      seenAuthorIds.add(author.id);
      // Prefer active poster from media table, fall back to legacy photoS3Key
      const activePoster = author.media?.find(
        (m: { type: string; isActive: boolean }) =>
          m.type === "poster" && m.isActive,
      );
      const photoKey =
        (activePoster as { thumbnailS3Key?: string; s3Key: string } | undefined)
          ?.thumbnailS3Key ??
        (activePoster as { s3Key: string } | undefined)?.s3Key ??
        author.photoS3Key;
      recentAuthors.push({
        id: author.id,
        slug: author.slug,
        name: author.name,
        photoS3Key: photoKey,
        photoTone:
          (activePoster as { tone?: string | null } | undefined)?.tone ?? null,
        nationality: countryDisplayName(author.country),
        birthYear: author.birthYear,
        deathYear: author.deathYear,
        worksCount: author.workAuthors.length,
      });
      if (recentAuthors.length >= 12) break;
    }
  }

  return {
    works: workCount.count,
    editions: editionCount.count,
    instances: instanceCount.count,
    authors: authorCount.count,
    recentWorks,
    topRatedWorks,
    wantedWorks: wantedWorks.sort(compareWorks),
    recentAuthors,
  };
}
