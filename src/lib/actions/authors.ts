"use server";

import { db } from "@/lib/db";
import { authors, workAuthors, editionContributors } from "@/lib/db/schema";
import { eq, asc, ilike, count } from "drizzle-orm";
import {
  createAuthorSchema,
  type CreateAuthorInput,
} from "@/lib/validations";

export async function getAuthors(opts?: {
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const { search, limit = 100, offset = 0 } = opts ?? {};

  return db.query.authors.findMany({
    where: search ? ilike(authors.name, `%${search}%`) : undefined,
    orderBy: asc(authors.sortName),
    limit,
    offset,
    with: {
      workAuthors: {
        columns: { workId: true },
      },
    },
  });
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
  return author;
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
  return { id };
}

export async function deleteAuthor(id: string) {
  await db.delete(authors).where(eq(authors.id, id));
  return { id };
}
