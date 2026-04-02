"use server";

import { db } from "@/lib/db";
import {
  works,
  workAuthors,
  workSubjects,
  workRecommenders,
  editions,
  instances,
  authors,
  media,
} from "@/lib/db/schema";
import { eq, desc, asc, ilike, like, count, and, inArray, gte, isNotNull, notInArray } from "drizzle-orm";
import { createWorkSchema, type CreateWorkInput } from "@/lib/validations";
import { generateWorkSlug, makeUnique } from "@/lib/utils/slugify";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { recordActivity } from "@/lib/activity/record";

type CatalogueStatus = typeof works.catalogueStatus.enumValues[number];
type AcquisitionPriority = typeof works.acquisitionPriority.enumValues[number];

export async function getWorks(opts?: {
  search?: string;
  limit?: number;
  offset?: number;
  sort?: "title" | "recent" | "year" | "rating" | "authorFirstName" | "authorLastName";
  order?: "asc" | "desc";
  filters?: {
    catalogueStatus?: string[];
    acquisitionPriority?: string[];
    minRating?: number;
    locationId?: string;
    hasPoster?: boolean;
  };
}) {
  const { search, limit = 50, offset = 0, sort = "recent", order, filters } = opts ?? {};

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

  // For DB-level sorts (author sorts are handled post-query)
  const orderBy = {
    title: orderFn(works.title),
    recent: orderFn(works.createdAt),
    year: orderFn(works.originalYear),
    rating: orderFn(works.rating),
    authorFirstName: orderFn(works.createdAt), // placeholder; sorted post-query
    authorLastName: orderFn(works.createdAt),   // placeholder; sorted post-query
  }[sort];

  // Build where clause combining search + filters
  const conditions = [];
  if (search) conditions.push(ilike(works.title, `%${search}%`));
  if (filters?.catalogueStatus?.length) {
    conditions.push(inArray(works.catalogueStatus, filters.catalogueStatus as CatalogueStatus[]));
  }
  if (filters?.acquisitionPriority?.length) {
    conditions.push(inArray(works.acquisitionPriority, filters.acquisitionPriority as AcquisitionPriority[]));
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
    const workIds = [...new Set(matchingInstances.map(r => r.workId))];
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
      .where(and(eq(media.type, "poster"), eq(media.isActive, true), isNotNull(media.workId)));
    const posterWorkIds = [...new Set(posterRows.map(r => r.workId!))];
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

  const results = await db.query.works.findMany({
    where,
    orderBy,
    limit,
    offset,
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
        },
      },
    },
  });

  // Post-query sort for author name sorts (Drizzle relational queries can't order by joined columns)
  if (sort === "authorFirstName" || sort === "authorLastName") {
    results.sort((a, b) => {
      const authorA = a.workAuthors[0]?.author;
      const authorB = b.workAuthors[0]?.author;

      let nameA: string, nameB: string;
      if (sort === "authorFirstName") {
        nameA = (authorA?.firstName || authorA?.name?.split(/\s+/)[0] || "").toLowerCase();
        nameB = (authorB?.firstName || authorB?.name?.split(/\s+/)[0] || "").toLowerCase();
      } else {
        // lastName: use sortName (format "Last, First") or fall back to last word of name
        nameA = (authorA?.sortName?.split(",")[0] || authorA?.name?.split(/\s+/).pop() || "").toLowerCase();
        nameB = (authorB?.sortName?.split(",")[0] || authorB?.name?.split(/\s+/).pop() || "").toLowerCase();
      }

      const cmp = nameA.localeCompare(nameB);
      return resolvedOrder === "desc" ? -cmp : cmp;
    });
  }

  return results;
}

export async function getWorkCount(search?: string, filters?: {
  catalogueStatus?: string[];
  acquisitionPriority?: string[];
  minRating?: number;
  locationId?: string;
  hasPoster?: boolean;
}) {
  const conditions = [];
  if (search) conditions.push(ilike(works.title, `%${search}%`));
  if (filters?.catalogueStatus?.length) {
    conditions.push(inArray(works.catalogueStatus, filters.catalogueStatus as CatalogueStatus[]));
  }
  if (filters?.acquisitionPriority?.length) {
    conditions.push(inArray(works.acquisitionPriority, filters.acquisitionPriority as AcquisitionPriority[]));
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
    const workIds = [...new Set(matchingInstances.map(r => r.workId))];
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
      .where(and(eq(media.type, "poster"), eq(media.isActive, true), isNotNull(media.workId)));
    const posterWorkIds = [...new Set(posterRows.map(r => r.workId!))];
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

  const [result] = await db
    .select({ count: count() })
    .from(works)
    .where(where);
  return result.count;
}

export async function getWork(id: string) {
  const result = await db.query.works.findFirst({
    where: eq(works.id, id),
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

  return result ?? null;
}

export async function getWorkBySlug(slug: string) {
  const result = await db.query.works.findFirst({
    where: eq(works.slug, slug),
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

  return result ?? null;
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
    where: ilike(works.title, opts.title.trim()),
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
    w.workAuthors.some((wa) =>
      wa.author.name.toLowerCase().includes(authorLower) ||
      authorLower.includes(wa.author.name.toLowerCase()),
    ),
  );

  return match ?? null;
}

export async function createWork(input: CreateWorkInput) {
  const parsed = createWorkSchema.parse(input);
  const { authorIds, subjectIds, recommenderIds, ...workData } = parsed;

  const [work] = await db.insert(works).values(workData).returning();

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

  recordActivity("work", updated.id, "work.created", { newValue: workData.title });
  invalidate(CACHE_TAGS.works);
  return updated;
}

export async function updateWork(
  id: string,
  input: Partial<CreateWorkInput>,
) {
  const { authorIds, subjectIds, recommenderIds, ...workData } = input;

  // Snapshot current state for activity diffing
  const prev = await db.query.works.findFirst({
    where: eq(works.id, id),
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

  if (Object.keys(workData).length > 0) {
    await db
      .update(works)
      .set({ ...workData, updatedAt: new Date() })
      .where(eq(works.id, id));
  }

  if (authorIds) {
    await db.delete(workAuthors).where(eq(workAuthors.workId, id));
    if (authorIds.length > 0) {
      await db.insert(workAuthors).values(
        authorIds.map((a, i) => ({
          workId: id,
          authorId: a.authorId,
          role: a.role,
          sortOrder: i,
        })),
      );
    }
  }

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
      where: eq(works.id, id),
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
      const authorChanged = authorIds !== undefined && newPrimaryAuthorId !== oldPrimaryAuthorId;

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
        const baseSlug = generateWorkSlug(effectiveTitle, effectiveAuthorName, id);

        // Exclude own current slug from uniqueness check
        const existing = await db
          .select({ slug: works.slug })
          .from(works)
          .where(like(works.slug, `${baseSlug}%`));
        const existingSlugs = existing
          .map((r) => r.slug)
          .filter((s): s is string => s !== null && s !== currentWork.slug);
        const newSlug = makeUnique(baseSlug, existingSlugs);

        await db.update(works).set({ slug: newSlug }).where(eq(works.id, id));
        recordWorkDiffs(id, prev, workData, authorIds);
        invalidate(CACHE_TAGS.works);
        return { id, slug: newSlug };
      }
    }
  }

  recordWorkDiffs(id, prev, workData, authorIds);
  invalidate(CACHE_TAGS.works);
  return { id };
}

/** Emit per-field activity events by diffing previous state against incoming input. */
function recordWorkDiffs(
  id: string,
  prev: { title: string; originalYear: number | null; originalLanguage: string | null; catalogueStatus: string | null; acquisitionPriority: string | null; rating: number | null; seriesId: string | null; workAuthors: { authorId: string; author: { id: string; name: string } }[] } | undefined,
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
    if (field in workData && workData[field] !== (prev as Record<string, unknown>)[field]) {
      recordActivity("work", id, eventKey, {
        oldValue: (prev as Record<string, unknown>)[field] as string | number | null,
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
        recordActivity("work", id, "work.author_added", { targetId: a.authorId });
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
  recordActivity("work", id, "work.deleted");
  await db.delete(works).where(eq(works.id, id));
  invalidate(CACHE_TAGS.works);
  return { id };
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

  return db.query.works.findMany({
    where: inArray(works.id, workIds),
    limit,
    orderBy: desc(works.createdAt),
    with: {
      workAuthors: {
        with: { author: { columns: { name: true } } },
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
          instances: { columns: { id: true } },
        },
      },
      media: {
        columns: { s3Key: true, thumbnailS3Key: true, type: true, isActive: true, cropX: true, cropY: true, cropZoom: true },
      },
    },
  });
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
      columns: { s3Key: true, thumbnailS3Key: true, type: true, isActive: true, cropX: true, cropY: true, cropZoom: true },
    },
  } as const;

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
    db.select({ count: count() }).from(works),
    db.select({ count: count() }).from(editions),
    db.select({ count: count() }).from(instances),
    db.select({ count: count() }).from(authors),
    // Recent additions
    db.query.works.findMany({
      orderBy: desc(works.createdAt),
      limit: 8,
      with: worksWith,
    }),
    // Top rated
    db.query.works.findMany({
      where: isNotNull(works.rating),
      orderBy: [desc(works.rating), desc(works.createdAt)],
      limit: 8,
      with: worksWith,
    }),
    // Wanted / shortlisted
    db.query.works.findMany({
      where: inArray(works.catalogueStatus, ["wanted", "shortlisted"]),
      orderBy: desc(works.createdAt),
      limit: 8,
      with: worksWith,
    }),
    // For recent authors: get more works so we can extract unique authors
    db.query.works.findMany({
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
                  columns: { s3Key: true, thumbnailS3Key: true, type: true, isActive: true },
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
        (m: { type: string; isActive: boolean }) => m.type === "poster" && m.isActive,
      );
      const photoKey =
        (activePoster as { thumbnailS3Key?: string; s3Key: string } | undefined)?.thumbnailS3Key ??
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
    wantedWorks,
    recentAuthors,
  };
}
