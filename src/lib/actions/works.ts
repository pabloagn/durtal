"use server";

import { bookPersonCondition } from "@/lib/catalogue/person-boundary";

import {
  bookCondition,
  requireBookWork,
  bookResult,
} from "@/lib/catalogue/book-boundary";

import {
  publisherWorkCondition,
  catalogueStatusCondition,
} from "@/lib/publishers/conditions";
import { bookAuthorQueries } from "@/lib/catalogue/book-credits";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { workSeriesPlan, resultRows } from "@/lib/series/work-series";
import { deleteUnusedObjects, workObjects } from "@/lib/s3/cleanup";
import {
  works,
  workAuthors,
  workSubjects,
  workRecommenders,
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
  like,
  count,
  and,
  or,
  inArray,
  gte,
  isNotNull,
  notInArray,
  ne,
} from "drizzle-orm";
import { z } from "zod";
import {
  createWorkSchema,
  updateWorkSchema,
  type CreateWorkInput,
  type UpdateWorkInput,
} from "@/lib/validations";
import { bookLinksSchema } from "@/lib/validations/book-links";
import { generateWorkSlug, makeUnique } from "@/lib/utils/slugify";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { recordActivity } from "@/lib/activity/record";
import { authorSearchCondition } from "@/lib/actions/utils/author-search";
import { authorOrderedBookIds } from "@/lib/actions/utils/author-ordered-books";
import { alphabeticalWorkIds } from "@/lib/actions/utils/alphabetical-works";
import { compareWorks } from "@/lib/utils/title-order";
import { workCardWith } from "@/lib/actions/utils/work-card-query";
import { markColumn, marksCondition } from "@/lib/actions/utils/work-marks";
import { WORK_MARKS, type WorkMarkKey } from "@/lib/constants/marks";

type AcquisitionPriority =
  (typeof works.acquisitionPriority.enumValues)[number];

/**
 * Build a search condition that matches works by title, author, ISBN,
 * publisher, or series name. Detects ISBN-shaped queries and prioritises
 * edition-level ISBN lookup.
 */
async function buildSearchCondition(search: string) {
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
          ilike(editions.isbn13, `%${target}%`),
          ilike(editions.isbn10, `%${target}%`),
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
    .where(ilike(editions.publisher, `%${search}%`));
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
    ilike(works.title, `%${search}%`),
    ilike(works.seriesName, `%${search}%`),
    sql`exists (select 1 from series where series.id = ${works.seriesId} and series.title ilike ${`%${search}%`})`,
  ];
  if (relatedWorkIds.size > 0) {
    orConditions.push(inArray(works.id, [...relatedWorkIds]));
  }
  return or(...orConditions)!;
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
    | "authorLastName";
  order?: "asc" | "desc";
  filters?: {
    catalogueStatus?: string[];
    isRare?: boolean;
    isPoison?: boolean;
    marks?: WorkMarkKey[];
    publisherIds?: string[];
    acquisitionPriority?: string[];
    minRating?: number;
    locationId?: string;
    hasPoster?: boolean;
  };
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
  };
  const resolvedOrder = order ?? defaultOrders[sort] ?? "asc";

  const orderFn = resolvedOrder === "asc" ? asc : desc;

  // Title and author order use lightweight IDs sorted before pagination.
  const orderBy = {
    title: orderFn(works.title),
    recent: orderFn(works.createdAt),
    year: orderFn(works.originalYear),
    rating: orderFn(works.rating),
    authorFirstName: orderFn(works.createdAt), // page membership is selected below
    authorLastName: orderFn(works.createdAt), // page membership is selected below
  }[sort];

  // Build where clause combining search + filters
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
  if (filters?.catalogueStatus?.length) {
    conditions.push(catalogueStatusCondition(filters.catalogueStatus));
  }
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
    if (workIds.length > 0) {
      conditions.push(inArray(works.id, workIds));
    } else {
      return [];
    }
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
      if (posterWorkIds.length > 0) {
        conditions.push(inArray(works.id, posterWorkIds));
      } else {
        return []; // no works have posters
      }
    } else {
      // Only works WITHOUT a poster
      if (posterWorkIds.length > 0) {
        conditions.push(notInArray(works.id, posterWorkIds));
      }
      // else: no works have posters, so all works match — no filter needed
    }
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

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
        },
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

export async function getWorkCount(
  search?: string,
  filters?: {
    catalogueStatus?: string[];
    isRare?: boolean;
    isPoison?: boolean;
    marks?: WorkMarkKey[];
    publisherIds?: string[];
    acquisitionPriority?: string[];
    minRating?: number;
    locationId?: string;
    hasPoster?: boolean;
  },
) {
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
  if (filters?.catalogueStatus?.length) {
    conditions.push(catalogueStatusCondition(filters.catalogueStatus));
  }
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
    if (workIds.length > 0) {
      conditions.push(inArray(works.id, workIds));
    } else {
      return 0;
    }
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
      if (posterWorkIds.length > 0) {
        conditions.push(inArray(works.id, posterWorkIds));
      } else {
        return 0;
      }
    } else {
      if (posterWorkIds.length > 0) {
        conditions.push(notInArray(works.id, posterWorkIds));
      }
    }
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [result] = await db.select({ count: count() }).from(works).where(where);
  return result.count;
}

export async function getWork(id: string) {
  const result = await db.query.works.findFirst({
    where: and(bookCondition, eq(works.id, id)),
    with: {
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
    },
  });

  return bookResult(result);
}

export async function getWorkBySlug(slug: string) {
  const result = await db.query.works.findFirst({
    where: and(bookCondition, eq(works.slug, slug)),
    with: {
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
    },
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

  // Fuzzy title + author match
  const candidates = await db.query.works.findMany({
    where: and(bookCondition, ilike(works.title, opts.title.trim())),
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

  // Check if any candidate has a matching author
  const authorLower = opts.authorName.trim().toLowerCase();
  const match = candidates.find((w) =>
    w.workAuthors.some(
      (wa) =>
        wa.author.name.toLowerCase().includes(authorLower) ||
        authorLower.includes(wa.author.name.toLowerCase()),
    ),
  );

  return match ?? null;
}

export async function createWork(input: CreateWorkInput) {
  const parsed = createWorkSchema.parse(input);
  const { authorIds, subjectIds, recommenderIds, ...workData } = parsed;

  const seriesPlan = workSeriesPlan(workData);
  const results = await atomic((d) => [
    ...seriesPlan.queries(d),
    d
      .insert(works)
      .values({ ...workData, ...seriesPlan.values })
      .returning(),
  ]);
  const [work] = resultRows<typeof works.$inferSelect>(results.at(-1));

  // Link authors
  if (authorIds.length > 0) {
    await db.insert(workAuthors).values(
      authorIds.map((a, i) => ({
        workId: work.id,
        authorId: a.authorId,
        role: a.role,
        sortOrder: i,
      })),
    );
  }

  // Link subjects
  if (subjectIds && subjectIds.length > 0) {
    await db.insert(workSubjects).values(
      subjectIds.map((subjectId) => ({
        workId: work.id,
        subjectId,
      })),
    );
  }

  // Link recommenders
  if (recommenderIds && recommenderIds.length > 0) {
    await db.insert(workRecommenders).values(
      recommenderIds.map((recommenderId) => ({
        workId: work.id,
        recommenderId,
      })),
    );
  }

  // Generate slug: look up primary author name, then set slug on work
  const primaryAuthorName = await (async () => {
    if (authorIds.length > 0) {
      const authorRow = await db.query.authors.findFirst({
        where: eq(authors.id, authorIds[0].authorId),
        columns: { name: true },
      });
      return authorRow?.name ?? "unknown";
    }
    return "unknown";
  })();

  const baseSlug = generateWorkSlug(work.title, primaryAuthorName, work.id);
  const existing = await db
    .select({ slug: works.slug })
    .from(works)
    .where(like(works.slug, `${baseSlug}%`));
  const existingSlugs = existing
    .map((r) => r.slug)
    .filter((s): s is string => s !== null);
  const slug = makeUnique(baseSlug, existingSlugs);

  const [updated] = await db
    .update(works)
    .set({ slug })
    .where(eq(works.id, work.id))
    .returning();

  recordActivity("work", updated.id, "work.created", {
    newValue: workData.title,
  });
  invalidate(CACHE_TAGS.works, CACHE_TAGS.series);
  return updated;
}

export async function updateWork(id: string, input: UpdateWorkInput) {
  const {
    authorIds,
    subjectIds,
    recommenderIds,
    goodreadsUrl,
    storygraphUrl,
    ...rest
  } = updateWorkSchema.parse(input);
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
  let savedSeriesId = prev.seriesId;
  if (Object.keys(workData).length > 0) {
    const results = await atomic((d) => [
      ...seriesPlan.queries(d),
      d
        .update(works)
        .set({ ...workData, updatedAt: new Date() })
        .where(and(bookCondition, eq(works.id, id)))
        .returning({ seriesId: works.seriesId }),
    ]);
    savedSeriesId =
      resultRows<{ seriesId: string | null }>(results.at(-1))[0]?.seriesId ??
      null;
    if ("seriesId" in workData) workData.seriesId = savedSeriesId;
  }

  if (authorIds) await atomic((d) => bookAuthorQueries(d, id, authorIds));

  if (subjectIds) {
    await db.delete(workSubjects).where(eq(workSubjects.workId, id));
    if (subjectIds.length > 0) {
      await db.insert(workSubjects).values(
        subjectIds.map((subjectId) => ({
          workId: id,
          subjectId,
        })),
      );
    }
  }

  if (recommenderIds) {
    await db.delete(workRecommenders).where(eq(workRecommenders.workId, id));
    if (recommenderIds.length > 0) {
      await db.insert(workRecommenders).values(
        recommenderIds.map((recommenderId) => ({
          workId: id,
          recommenderId,
        })),
      );
    }
  }

  // Regenerate slug only if title or authors ACTUALLY changed
  if (workData.title !== undefined || authorIds !== undefined) {
    const currentWork = await db.query.works.findFirst({
      where: and(bookCondition, eq(works.id, id)),
      columns: { title: true, slug: true },
      with: {
        workAuthors: {
          with: { author: { columns: { id: true, name: true } } },
          orderBy: asc(workAuthors.sortOrder),
          limit: 1,
        },
      },
    });

    if (currentWork) {
      // Check if title or primary author actually changed
      const oldTitle = currentWork.title;
      const oldPrimaryAuthorId = currentWork.workAuthors[0]?.author.id;
      const newTitle = workData.title ?? oldTitle;
      const newPrimaryAuthorId = authorIds?.[0]?.authorId ?? oldPrimaryAuthorId;
      const titleChanged = newTitle !== oldTitle;
      const authorChanged =
        authorIds !== undefined && newPrimaryAuthorId !== oldPrimaryAuthorId;

      if (titleChanged || authorChanged) {
        const primaryAuthorName =
          currentWork.workAuthors[0]?.author.name ?? "unknown";
        // Use the NEW title for slug generation (it was already written to DB above)
        const effectiveTitle = workData.title ?? currentWork.title;
        // If author changed, look up the new author name
        let effectiveAuthorName = primaryAuthorName;
        if (authorChanged && authorIds && authorIds.length > 0) {
          const newAuthor = await db.query.authors.findFirst({
            where: eq(authors.id, authorIds[0].authorId),
            columns: { name: true },
          });
          effectiveAuthorName = newAuthor?.name ?? "unknown";
        }
        const baseSlug = generateWorkSlug(
          effectiveTitle,
          effectiveAuthorName,
          id,
        );

        // Exclude own current slug from uniqueness check
        const existing = await db
          .select({ slug: works.slug })
          .from(works)
          .where(like(works.slug, `${baseSlug}%`));
        const existingSlugs = existing
          .map((r) => r.slug)
          .filter((s): s is string => s !== null && s !== currentWork.slug);
        const newSlug = makeUnique(baseSlug, existingSlugs);

        await db
          .update(works)
          .set({ slug: newSlug })
          .where(and(bookCondition, eq(works.id, id)));
        recordWorkDiffs(id, prev, workData, authorIds);
        invalidate(CACHE_TAGS.works, CACHE_TAGS.series);
        return { id, slug: newSlug };
      }
    }
  }

  recordWorkDiffs(id, prev, workData, authorIds);
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
      with: worksWith,
    }),
    // Top rated
    db.query.works.findMany({
      where: and(bookCondition, isNotNull(works.rating)),
      orderBy: [desc(works.rating), desc(works.createdAt)],
      limit: 8,
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
                country: { columns: { name: true } },
                workAuthors: { columns: { workId: true } },
                media: {
                  columns: {
                    s3Key: true,
                    thumbnailS3Key: true,
                    type: true,
                    isActive: true,
                  },
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
        nationality: author.country?.name ?? null,
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
