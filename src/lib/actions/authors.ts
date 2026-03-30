"use server";

import { db } from "@/lib/db";
import { authors, workAuthors, editionContributors, countries } from "@/lib/db/schema";
import { eq, and, asc, desc, ilike, like, inArray, count, sql, isNull, isNotNull, gte, lte, min, max } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import {
  createAuthorSchema,
  type CreateAuthorInput,
} from "@/lib/validations";
import { generateAuthorSlug, makeUnique } from "@/lib/utils/slugify";
import { computeZodiacSign } from "@/lib/utils/zodiac";

export async function getAuthors(opts?: {
  search?: string;
  limit?: number;
  offset?: number;
  sort?: "name" | "recent" | "birth" | "works";
  order?: "asc" | "desc";
  filters?: {
    nationalities?: string[];
    genders?: string[];
    zodiacSigns?: string[];
    birthYearMin?: number;
    birthYearMax?: number;
    deathYearMin?: number;
    deathYearMax?: number;
    alive?: boolean;
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

  // Gender filtering
  if (filters?.genders?.length) {
    const validGenders = filters.genders.filter((g) => g === "male" || g === "female") as ("male" | "female")[];
    if (validGenders.length > 0) {
      conditions.push(inArray(authors.gender, validGenders));
    }
  }

  // Zodiac sign filtering (handles "__none__" sentinel for null values)
  if (filters?.zodiacSigns?.length) {
    const hasNone = filters.zodiacSigns.includes("__none__");
    const realSigns = filters.zodiacSigns.filter((z) => z !== "__none__");
    if (hasNone && realSigns.length > 0) {
      // NULL OR one of the listed signs
      conditions.push(
        sql`(${authors.zodiacSign} IS NULL OR ${authors.zodiacSign} = ANY(ARRAY[${sql.join(realSigns.map((s) => sql`${s}`), sql`, `)}]))`,
      );
    } else if (hasNone) {
      conditions.push(isNull(authors.zodiacSign));
    } else {
      conditions.push(inArray(authors.zodiacSign, realSigns));
    }
  }

  // Birth year range
  if (filters?.birthYearMin != null) {
    conditions.push(gte(authors.birthYear, filters.birthYearMin));
  }
  if (filters?.birthYearMax != null) {
    conditions.push(lte(authors.birthYear, filters.birthYearMax));
  }

  // Death year range
  if (filters?.deathYearMin != null) {
    conditions.push(gte(authors.deathYear, filters.deathYearMin));
  }
  if (filters?.deathYearMax != null) {
    conditions.push(lte(authors.deathYear, filters.deathYearMax));
  }

  // Alive / deceased filter
  if (filters?.alive === true) {
    conditions.push(isNull(authors.deathYear));
  } else if (filters?.alive === false) {
    conditions.push(isNotNull(authors.deathYear));
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

  // For "works" sort, we need DB-level ordering by a subquery count.
  // The relational query API doesn't support orderBy on derived counts,
  // so we first fetch the sorted author IDs, then load full records.
  if (sort === "works") {
    const worksCountSq = db
      .select({
        authorId: workAuthors.authorId,
        cnt: count().as("cnt"),
      })
      .from(workAuthors)
      .groupBy(workAuthors.authorId)
      .as("works_count");

    const direction = order === "asc" ? asc : (order === "desc" ? desc : desc);

    const sortedIds = await db
      .select({ id: authors.id })
      .from(authors)
      .leftJoin(worksCountSq, eq(authors.id, worksCountSq.authorId))
      .where(where)
      .orderBy(direction(sql`coalesce(${worksCountSq.cnt}, 0)`), asc(authors.sortName))
      .limit(limit)
      .offset(offset);

    const ids = sortedIds.map((r) => r.id);
    if (ids.length === 0) return [];

    const results = await db.query.authors.findMany({
      where: inArray(authors.id, ids),
      with: {
        country: { columns: { name: true } },
        workAuthors: { columns: { workId: true } },
        media: {
          columns: { s3Key: true, thumbnailS3Key: true, type: true, isActive: true, cropX: true, cropY: true, cropZoom: true },
        },
      },
    });

    // Preserve the DB sort order
    const idOrder = new Map(ids.map((id, i) => [id, i]));
    results.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

    return results;
  }

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
        columns: { s3Key: true, thumbnailS3Key: true, type: true, isActive: true, cropX: true, cropY: true, cropZoom: true },
      },
    },
  });

  return results;
}

export async function getAuthorCount(opts?: {
  search?: string;
  filters?: {
    nationalities?: string[];
    genders?: string[];
    zodiacSigns?: string[];
    birthYearMin?: number;
    birthYearMax?: number;
    deathYearMin?: number;
    deathYearMax?: number;
    alive?: boolean;
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

  if (filters?.genders?.length) {
    const validGenders = filters.genders.filter((g) => g === "male" || g === "female") as ("male" | "female")[];
    if (validGenders.length > 0) {
      conditions.push(inArray(authors.gender, validGenders));
    }
  }

  if (filters?.zodiacSigns?.length) {
    const hasNone = filters.zodiacSigns.includes("__none__");
    const realSigns = filters.zodiacSigns.filter((z) => z !== "__none__");
    if (hasNone && realSigns.length > 0) {
      conditions.push(
        sql`(${authors.zodiacSign} IS NULL OR ${authors.zodiacSign} = ANY(ARRAY[${sql.join(realSigns.map((s) => sql`${s}`), sql`, `)}]))`,
      );
    } else if (hasNone) {
      conditions.push(isNull(authors.zodiacSign));
    } else {
      conditions.push(inArray(authors.zodiacSign, realSigns));
    }
  }

  if (filters?.birthYearMin != null) {
    conditions.push(gte(authors.birthYear, filters.birthYearMin));
  }
  if (filters?.birthYearMax != null) {
    conditions.push(lte(authors.birthYear, filters.birthYearMax));
  }
  if (filters?.deathYearMin != null) {
    conditions.push(gte(authors.deathYear, filters.deathYearMin));
  }
  if (filters?.deathYearMax != null) {
    conditions.push(lte(authors.deathYear, filters.deathYearMax));
  }
  if (filters?.alive === true) {
    conditions.push(isNull(authors.deathYear));
  } else if (filters?.alive === false) {
    conditions.push(isNotNull(authors.deathYear));
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

export async function getDistinctGenders(): Promise<string[]> {
  const result = await db
    .selectDistinct({ gender: authors.gender })
    .from(authors)
    .where(isNotNull(authors.gender))
    .orderBy(asc(authors.gender));
  return result
    .map((r) => r.gender)
    .filter((g) => g !== null)
    .map((g) => g as string);
}

export async function getDistinctZodiacSigns(): Promise<string[]> {
  const result = await db
    .selectDistinct({ zodiacSign: authors.zodiacSign })
    .from(authors)
    .where(isNotNull(authors.zodiacSign))
    .orderBy(asc(authors.zodiacSign));
  return result.map((r) => r.zodiacSign).filter((z): z is string => z !== null);
}

export async function getAuthorBirthYearRange(): Promise<{ min: number | null; max: number | null }> {
  const [result] = await db
    .select({
      min: min(authors.birthYear),
      max: max(authors.birthYear),
    })
    .from(authors)
    .where(isNotNull(authors.birthYear));
  return { min: result?.min ?? null, max: result?.max ?? null };
}

export async function getAuthorDeathYearRange(): Promise<{ min: number | null; max: number | null }> {
  const [result] = await db
    .select({
      min: min(authors.deathYear),
      max: max(authors.deathYear),
    })
    .from(authors)
    .where(isNotNull(authors.deathYear));
  return { min: result?.min ?? null, max: result?.max ?? null };
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

  // Auto-compute zodiac sign from birth month/day
  const zodiacSign =
    parsed.birthMonth != null && parsed.birthDay != null
      ? computeZodiacSign(parsed.birthMonth, parsed.birthDay)
      : null;

  const [author] = await db
    .insert(authors)
    .values({ ...parsed, sortName, zodiacSign })
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
  // Recompute zodiac sign if birth month or day is changing
  let zodiacSign: string | null | undefined;
  if (input.birthMonth !== undefined || input.birthDay !== undefined) {
    // Need the current values for the fields not included in the update
    const current = await db.query.authors.findFirst({
      where: eq(authors.id, id),
      columns: { birthMonth: true, birthDay: true },
    });
    const month = input.birthMonth ?? current?.birthMonth ?? null;
    const day = input.birthDay ?? current?.birthDay ?? null;
    zodiacSign = month != null && day != null ? computeZodiacSign(month, day) : null;
  }

  const updatePayload = {
    ...input,
    ...(zodiacSign !== undefined ? { zodiacSign } : {}),
    updatedAt: new Date(),
  };

  await db
    .update(authors)
    .set(updatePayload)
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

/**
 * Merge source author into target author.
 * Transfers all work_authors, edition_contributors, and author_contribution_types
 * from source to target, skipping duplicates (same composite PK).
 * Then deletes the source author.
 */
export async function mergeAuthors(sourceId: string, targetId: string) {
  if (sourceId === targetId) {
    throw new Error("Cannot merge an author into itself");
  }

  const [source, target] = await Promise.all([
    db.query.authors.findFirst({ where: eq(authors.id, sourceId) }),
    db.query.authors.findFirst({ where: eq(authors.id, targetId) }),
  ]);
  if (!source) throw new Error("Source author not found");
  if (!target) throw new Error("Target author not found");

  // 1. Transfer workAuthors — skip rows that would conflict on (workId, targetId, role)
  const sourceWorkAuthors = await db
    .select()
    .from(workAuthors)
    .where(eq(workAuthors.authorId, sourceId));

  const targetWorkAuthors = await db
    .select()
    .from(workAuthors)
    .where(eq(workAuthors.authorId, targetId));

  const targetWAKeys = new Set(
    targetWorkAuthors.map((r) => `${r.workId}::${r.role}`),
  );

  for (const row of sourceWorkAuthors) {
    const key = `${row.workId}::${row.role}`;
    if (!targetWAKeys.has(key)) {
      // Transfer: delete old, insert new (can't update composite PK)
      await db
        .delete(workAuthors)
        .where(
          and(
            eq(workAuthors.workId, row.workId),
            eq(workAuthors.authorId, sourceId),
            eq(workAuthors.role, row.role),
          ),
        );
      await db.insert(workAuthors).values({
        workId: row.workId,
        authorId: targetId,
        role: row.role,
        sortOrder: row.sortOrder,
      });
    }
    // Conflicting rows will be cascade-deleted when source author is removed
  }

  // 2. Transfer editionContributors — skip conflicts on (editionId, targetId, role)
  const sourceEdContribs = await db
    .select()
    .from(editionContributors)
    .where(eq(editionContributors.authorId, sourceId));

  const targetEdContribs = await db
    .select()
    .from(editionContributors)
    .where(eq(editionContributors.authorId, targetId));

  const targetECKeys = new Set(
    targetEdContribs.map((r) => `${r.editionId}::${r.role}`),
  );

  for (const row of sourceEdContribs) {
    const key = `${row.editionId}::${row.role}`;
    if (!targetECKeys.has(key)) {
      await db
        .delete(editionContributors)
        .where(
          and(
            eq(editionContributors.editionId, row.editionId),
            eq(editionContributors.authorId, sourceId),
            eq(editionContributors.role, row.role),
          ),
        );
      await db.insert(editionContributors).values({
        editionId: row.editionId,
        authorId: targetId,
        role: row.role,
        sortOrder: row.sortOrder,
      });
    }
  }

  // 3. Transfer authorContributionTypes — skip conflicts
  const { authorContributionTypes } = await import("@/lib/db/schema");

  const sourceACT = await db
    .select()
    .from(authorContributionTypes)
    .where(eq(authorContributionTypes.authorId, sourceId));

  const targetACT = await db
    .select()
    .from(authorContributionTypes)
    .where(eq(authorContributionTypes.authorId, targetId));

  const targetACTKeys = new Set(
    targetACT.map((r) => r.contributionTypeId),
  );

  for (const row of sourceACT) {
    if (!targetACTKeys.has(row.contributionTypeId)) {
      await db
        .delete(authorContributionTypes)
        .where(
          and(
            eq(authorContributionTypes.authorId, sourceId),
            eq(authorContributionTypes.contributionTypeId, row.contributionTypeId),
          ),
        );
      await db.insert(authorContributionTypes).values({
        authorId: targetId,
        contributionTypeId: row.contributionTypeId,
      });
    }
  }

  // 4. Delete source author (cascade removes any remaining references)
  await db.delete(authors).where(eq(authors.id, sourceId));

  return { targetId, sourceName: source.name, targetName: target.name };
}
