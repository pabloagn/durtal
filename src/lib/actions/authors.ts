"use server";

import { db } from "@/lib/db";
import { authors, workAuthors, editionContributors, countries, comments, activityEvents, galleryLayouts } from "@/lib/db/schema";
import { eq, and, asc, desc, like, inArray, count, sql, isNotNull, min, max } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { buildAuthorFilterConditions } from "@/lib/actions/utils/author-filters";
import {
  authorNameEquals,
  authorSearchCondition,
  authorSearchRank,
} from "@/lib/actions/utils/author-search";
import type { NationalityOption } from "@/lib/utils/nationality-param";
import {
  createAuthorSchema,
  type CreateAuthorInput,
} from "@/lib/validations";
import { generateAuthorSlug, makeUnique } from "@/lib/utils/slugify";
import { computeZodiacSign } from "@/lib/utils/zodiac";
import { recordActivity } from "@/lib/activity/record";

export async function getAuthors(opts?: {
  search?: string;
  limit?: number;
  offset?: number;
  /** "relevance" orders by search match quality (needs `search`) */
  sort?: "relevance" | "name" | "lastName" | "recent" | "birth" | "works";
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
  const { search, limit = 48, offset = 0, order, filters } = opts ?? {};
  // Relevance only makes sense with a search term; fall back to name order
  const sort = opts?.sort === "relevance" && !search?.trim() ? "name" : (opts?.sort ?? "name");

  const filterConditions = await buildAuthorFilterConditions(filters);
  if (filterConditions === null) return [];

  const conditions: SQL[] = [...filterConditions];
  const searchCondition = search ? authorSearchCondition(search) : undefined;
  if (searchCondition) conditions.push(searchCondition);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Determine sort direction: use explicit order if provided, otherwise defaults
  const dirFn = order
    ? order === "asc" ? asc : desc
    : (() => {
        switch (sort) {
          case "recent":
          case "works":
          case "relevance":
            return desc;
          case "birth":
          case "name":
          case "lastName":
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
          columns: { s3Key: true, thumbnailS3Key: true, type: true, isActive: true, cropX: true, cropY: true, cropZoom: true, brightness: true, contrast: true },
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
      case "relevance":
        return [dirFn(authorSearchRank(search!)), asc(authors.name)];
      case "recent":
        return dirFn(authors.createdAt);
      case "birth":
        return dirFn(authors.birthYear);
      case "lastName":
        return dirFn(authors.sortName);
      case "name":
      default:
        return dirFn(authors.name);
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
        columns: { s3Key: true, thumbnailS3Key: true, type: true, isActive: true, cropX: true, cropY: true, cropZoom: true, brightness: true, contrast: true },
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

  const filterConditions = await buildAuthorFilterConditions(filters);
  if (filterConditions === null) return 0;

  const conditions: SQL[] = [...filterConditions];
  const searchCondition = search ? authorSearchCondition(search) : undefined;
  if (searchCondition) conditions.push(searchCondition);

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [result] = await db
    .select({ count: count() })
    .from(authors)
    .where(where);
  return result.count;
}

export async function getDistinctNationalities(): Promise<NationalityOption[]> {
  return db
    .selectDistinct({ code: countries.alpha2, name: countries.name })
    .from(countries)
    .innerJoin(authors, eq(authors.nationalityId, countries.id))
    .orderBy(asc(countries.name));
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
      country: { columns: { id: true, name: true, alpha2: true } },
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
                columns: { s3Key: true, thumbnailS3Key: true, type: true, isActive: true, cropX: true, cropY: true, cropZoom: true, brightness: true, contrast: true },
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

  recordActivity("author", updated.id, "author.created", { newValue: parsed.name });
  return updated;
}

/**
 * Find an existing author by name or create a new one. The match ignores
 * accents, case and punctuation, so "Peter Nadas" reuses "Péter Nádas"
 * instead of creating a duplicate. An exact spelling wins, then the oldest.
 */
export async function findOrCreateAuthor(name: string) {
  const trimmed = name.trim();
  const existing = await db.query.authors.findFirst({
    where: authorNameEquals(trimmed),
    orderBy: [desc(sql`${authors.name} = ${trimmed}`), asc(authors.createdAt)],
  });
  if (existing) return existing;
  return createAuthor({ name: trimmed });
}

/**
 * Lightweight author search for autocomplete dropdowns.
 * Returns id + name only.
 */
export async function searchAuthorsLite(query: string) {
  const where = authorSearchCondition(query);
  if (!where) return [];
  return db.query.authors.findMany({
    where,
    columns: { id: true, name: true },
    orderBy: [desc(authorSearchRank(query)), asc(authors.name)],
    limit: 10,
  });
}

export async function updateAuthor(id: string, input: Partial<CreateAuthorInput>) {
  // Snapshot for activity diffing + zodiac recomputation
  const prev = await db.query.authors.findFirst({
    where: eq(authors.id, id),
    columns: {
      name: true, slug: true, birthYear: true, deathYear: true,
      gender: true, nationalityId: true, bio: true,
      birthMonth: true, birthDay: true,
    },
  });

  // Recompute zodiac sign if birth month or day is changing
  let zodiacSign: string | null | undefined;
  if (input.birthMonth !== undefined || input.birthDay !== undefined) {
    const month = input.birthMonth ?? prev?.birthMonth ?? null;
    const day = input.birthDay ?? prev?.birthDay ?? null;
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

  // Record activity diffs
  if (prev) {
    const diffs: [string, string, unknown, unknown][] = [
      ["name", "author.name_changed", prev.name, input.name],
      ["birthYear", "author.birth_year_changed", prev.birthYear, input.birthYear],
      ["deathYear", "author.death_year_changed", prev.deathYear, input.deathYear],
      ["gender", "author.gender_changed", prev.gender, input.gender],
      ["nationalityId", "author.nationality_changed", prev.nationalityId, input.nationalityId],
      ["bio", "author.biography_changed", prev.bio, input.bio],
    ];
    for (const [field, eventKey, oldVal, newVal] of diffs) {
      if (newVal !== undefined && newVal !== oldVal) {
        recordActivity("author", id, eventKey, {
          oldValue: oldVal as string | number | null,
          newValue: (field === "bio" ? undefined : newVal) as string | number | null,
        });
      }
    }
  }

  return { id };
}

export async function deleteAuthor(id: string) {
  recordActivity("author", id, "author.deleted");

  // Clean up polymorphic records (not covered by FK cascades)
  await db.delete(comments).where(and(eq(comments.entityType, "author"), eq(comments.entityId, id)));
  await db.delete(activityEvents).where(and(eq(activityEvents.entityType, "author"), eq(activityEvents.entityId, id)));
  await db.delete(galleryLayouts).where(and(eq(galleryLayouts.entityType, "author"), eq(galleryLayouts.entityId, id)));

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

  const { authorContributionTypes } = await import("@/lib/db/schema");

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
