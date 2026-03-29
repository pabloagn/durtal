"use server";

import { db } from "@/lib/db";
import { authors, workAuthors, editionContributors, countries } from "@/lib/db/schema";
import { eq, and, asc, desc, ilike, like, inArray, count } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  createAuthorSchema,
  type CreateAuthorInput,
} from "@/lib/validations";
import { generateAuthorSlug, makeUnique } from "@/lib/utils/slugify";

export async function getAuthors(opts?: {
  search?: string;
  limit?: number;
  offset?: number;
  sort?: "name" | "recent" | "birth" | "works";
  order?: "asc" | "desc";
  filters?: {
    nationalities?: string[];
  };
}) {
  const { search, limit = 48, offset = 0, sort = "name", order, filters } = opts ?? {};

  const conditions: SQL[] = [];
  if (search) {
    conditions.push(ilike(authors.name, `%${search}%`));
  }

  // Nationality filtering: resolve country names to IDs, then filter authors
  if (filters?.nationalities?.length) {
    const countryRows = await db
      .select({ id: countries.id })
      .from(countries)
      .where(inArray(countries.name, filters.nationalities));
    const countryIds = countryRows.map((c) => c.id);
    if (countryIds.length > 0) {
      conditions.push(inArray(authors.nationalityId, countryIds));
    } else {
      return [];
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Determine sort direction: use explicit order if provided, otherwise defaults
  const dirFn = order
    ? order === "asc" ? asc : desc
    : (() => {
        switch (sort) {
          case "recent":
          case "works":
            return desc;
          case "birth":
          case "name":
          default:
            return asc;
        }
      })();

  const orderBy = (() => {
    switch (sort) {
      case "recent":
        return dirFn(authors.createdAt);
      case "birth":
        return dirFn(authors.birthYear);
      case "name":
      default:
        return dirFn(authors.sortName);
    }
  })();

  const results = await db.query.authors.findMany({
    where,
    orderBy,
    limit,
    offset,
    with: {
      country: { columns: { name: true } },
      workAuthors: {
        columns: { workId: true },
      },
      media: {
        columns: { s3Key: true, thumbnailS3Key: true, type: true, isActive: true },
      },
    },
  });

  // For "works" sort, we sort client-side since it's a derived count
  if (sort === "works") {
    const ascending = order ? order === "asc" : false;
    results.sort((a, b) =>
      ascending
        ? a.workAuthors.length - b.workAuthors.length
        : b.workAuthors.length - a.workAuthors.length
    );
  }

  return results;
}

export async function getAuthorCount(opts?: {
  search?: string;
  filters?: {
    nationalities?: string[];
  };
}) {
  const { search, filters } = opts ?? {};

  const conditions: SQL[] = [];
  if (search) {
    conditions.push(ilike(authors.name, `%${search}%`));
  }

  if (filters?.nationalities?.length) {
    const countryRows = await db
      .select({ id: countries.id })
      .from(countries)
      .where(inArray(countries.name, filters.nationalities));
    const countryIds = countryRows.map((c) => c.id);
    if (countryIds.length > 0) {
      conditions.push(inArray(authors.nationalityId, countryIds));
    } else {
      return 0;
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [result] = await db
    .select({ count: count() })
    .from(authors)
    .where(where);
  return result.count;
}

export async function getDistinctNationalities(): Promise<string[]> {
  const result = await db
    .selectDistinct({ name: countries.name })
    .from(countries)
    .innerJoin(authors, eq(authors.nationalityId, countries.id))
    .orderBy(asc(countries.name));
  return result.map((r) => r.name);
}

export async function getAuthor(id: string) {
  return db.query.authors.findFirst({
    where: eq(authors.id, id),
    with: {
      country: { columns: { name: true } },
      workAuthors: {
        with: {
          work: {
            with: {
              editions: {
                columns: {
                  id: true,
                  title: true,
                  thumbnailS3Key: true,
                  publicationYear: true,
                },
              },
            },
          },
        },
        orderBy: asc(workAuthors.sortOrder),
      },
      editionContributors: {
        with: {
          edition: {
            columns: {
              id: true,
              title: true,
              thumbnailS3Key: true,
              publicationYear: true,
            },
          },
        },
        orderBy: asc(editionContributors.sortOrder),
      },
      media: true,
    },
  });
}

export async function getAuthorBySlug(slug: string) {
  return db.query.authors.findFirst({
    where: eq(authors.slug, slug),
    with: {
      country: { columns: { id: true, name: true } },
      workAuthors: {
        with: {
          work: {
            with: {
              editions: {
                columns: {
                  id: true,
                  title: true,
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
              workAuthors: {
                with: { author: { columns: { name: true } } },
                orderBy: asc(workAuthors.sortOrder),
                limit: 1,
              },
            },
          },
        },
        orderBy: asc(workAuthors.sortOrder),
      },
      editionContributors: {
        with: {
          edition: {
            columns: {
              id: true,
              title: true,
              thumbnailS3Key: true,
              publicationYear: true,
            },
          },
        },
        orderBy: asc(editionContributors.sortOrder),
      },
      media: true,
    },
  });
}

export async function getCountries() {
  const { countries } = await import("@/lib/db/schema");
  return db.query.countries.findMany({
    orderBy: asc(countries.name),
    columns: { id: true, name: true },
  });
}

export async function createAuthor(input: CreateAuthorInput) {
  const parsed = createAuthorSchema.parse(input);

  // Auto-generate sortName if not provided (Last, First)
  const sortName =
    parsed.sortName ??
    (() => {
      const parts = parsed.name.trim().split(/\s+/);
      if (parts.length <= 1) return parsed.name;
      const last = parts.pop()!;
      return `${last}, ${parts.join(" ")}`;
    })();

  const [author] = await db
    .insert(authors)
    .values({ ...parsed, sortName })
    .returning();

  // Generate and set slug
  const baseSlug = generateAuthorSlug(author.name);
  const existing = await db
    .select({ slug: authors.slug })
    .from(authors)
    .where(like(authors.slug, `${baseSlug}%`));
  const existingSlugs = existing
    .map((r) => r.slug)
    .filter((s): s is string => s !== null);
  const slug = makeUnique(baseSlug, existingSlugs);

  const [updated] = await db
    .update(authors)
    .set({ slug })
    .where(eq(authors.id, author.id))
    .returning();

  return updated;
}

/**
 * Find an existing author by name (case-insensitive) or create a new one.
 * Prevents duplicate author creation in the add-book wizard.
 */
export async function findOrCreateAuthor(name: string) {
  const trimmed = name.trim();
  const existing = await db.query.authors.findFirst({
    where: ilike(authors.name, trimmed),
  });
  if (existing) return existing;
  return createAuthor({ name: trimmed });
}

export async function updateAuthor(id: string, input: Partial<CreateAuthorInput>) {
  await db
    .update(authors)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(authors.id, id));

  // Regenerate slug when name changes
  if (input.name !== undefined) {
    const currentAuthor = await db.query.authors.findFirst({
      where: eq(authors.id, id),
      columns: { name: true, slug: true },
    });

    if (currentAuthor) {
      const baseSlug = generateAuthorSlug(currentAuthor.name);
      const existing = await db
        .select({ slug: authors.slug })
        .from(authors)
        .where(like(authors.slug, `${baseSlug}%`));
      const existingSlugs = existing
        .map((r) => r.slug)
        .filter((s): s is string => s !== null && s !== currentAuthor.slug);
      const slug = makeUnique(baseSlug, existingSlugs);
      await db.update(authors).set({ slug }).where(eq(authors.id, id));
    }
  }

  return { id };
}

export async function deleteAuthor(id: string) {
  await db.delete(authors).where(eq(authors.id, id));
  return { id };
}
