"use server";

import { db } from "@/lib/db";
import { authors, workAuthors, editionContributors } from "@/lib/db/schema";
import { eq, asc, desc, ilike, like, count } from "drizzle-orm";
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
}) {
  const { search, limit = 48, offset = 0, sort = "name" } = opts ?? {};

  const where = search ? ilike(authors.name, `%${search}%`) : undefined;

  const orderBy = (() => {
    switch (sort) {
      case "recent":
        return desc(authors.createdAt);
      case "birth":
        return asc(authors.birthYear);
      case "name":
      default:
        return asc(authors.sortName);
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
    },
  });

  // For "works" sort, we sort client-side since it's a derived count
  if (sort === "works") {
    results.sort((a, b) => b.workAuthors.length - a.workAuthors.length);
  }

  return results;
}

export async function getAuthorCount(search?: string) {
  const [result] = await db
    .select({ count: count() })
    .from(authors)
    .where(search ? ilike(authors.name, `%${search}%`) : undefined);
  return result.count;
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
