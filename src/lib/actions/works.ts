"use server";

import { db } from "@/lib/db";
import {
  works,
  workAuthors,
  workSubjects,
  editions,
  instances,
  authors,
} from "@/lib/db/schema";
import { eq, desc, asc, ilike, like, count } from "drizzle-orm";
import { createWorkSchema, type CreateWorkInput } from "@/lib/validations";
import { generateWorkSlug, makeUnique } from "@/lib/utils/slugify";

export async function getWorks(opts?: {
  search?: string;
  limit?: number;
  offset?: number;
  sort?: "title" | "recent" | "year" | "rating";
}) {
  const { search, limit = 50, offset = 0, sort = "recent" } = opts ?? {};

  const orderBy = {
    title: asc(works.title),
    recent: desc(works.createdAt),
    year: desc(works.originalYear),
    rating: desc(works.rating),
  }[sort];

  const results = await db.query.works.findMany({
    where: search ? ilike(works.title, `%${search}%`) : undefined,
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
    },
  });

  return results;
}

export async function getWorkCount(search?: string) {
  const [result] = await db
    .select({ count: count() })
    .from(works)
    .where(search ? ilike(works.title, `%${search}%`) : undefined);
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
      recommender: true,
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
      recommender: true,
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
  const { authorIds, subjectIds, ...workData } = parsed;

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

  return updated;
}

export async function updateWork(
  id: string,
  input: Partial<CreateWorkInput>,
) {
  const { authorIds, subjectIds, ...workData } = input;

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

  // Regenerate slug if title or authors changed
  if (workData.title !== undefined || authorIds !== undefined) {
    const currentWork = await db.query.works.findFirst({
      where: eq(works.id, id),
      columns: { title: true, slug: true },
      with: {
        workAuthors: {
          with: { author: { columns: { name: true } } },
          orderBy: asc(workAuthors.sortOrder),
          limit: 1,
        },
      },
    });

    if (currentWork) {
      const primaryAuthorName =
        currentWork.workAuthors[0]?.author.name ?? "unknown";
      const baseSlug = generateWorkSlug(currentWork.title, primaryAuthorName, id);

      // Exclude own current slug from uniqueness check
      const existing = await db
        .select({ slug: works.slug })
        .from(works)
        .where(like(works.slug, `${baseSlug}%`));
      const existingSlugs = existing
        .map((r) => r.slug)
        .filter((s): s is string => s !== null && s !== currentWork.slug);
      const slug = makeUnique(baseSlug, existingSlugs);

      await db.update(works).set({ slug }).where(eq(works.id, id));
    }
  }

  return { id };
}

export async function deleteWork(id: string) {
  await db.delete(works).where(eq(works.id, id));
  return { id };
}

/** Dashboard stats */
export async function getLibraryStats() {
  const [workCount] = await db.select({ count: count() }).from(works);
  const [editionCount] = await db.select({ count: count() }).from(editions);
  const [instanceCount] = await db.select({ count: count() }).from(instances);
  const [authorCount] = await db.select({ count: count() }).from(authors);

  const recentWorks = await db.query.works.findMany({
    orderBy: desc(works.createdAt),
    limit: 8,
    with: {
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
    },
  });

  return {
    works: workCount.count,
    editions: editionCount.count,
    instances: instanceCount.count,
    authors: authorCount.count,
    recentWorks,
  };
}
