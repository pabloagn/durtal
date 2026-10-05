"use server";

import { PERSON_CREDITS, bookPersonCondition } from "@/lib/catalogue/person-boundary";
import { resultRows } from "@/lib/publishers/resolution";
import type { WorkKind } from "@/lib/catalogue/kinds";
import type { PersonRole } from "@/lib/catalogue/person-roles";
import { atomic } from "@/lib/db/atomic";
import { uniqueSlug } from "@/lib/catalogue/slugs";
import { deletePerson, getPersonMergePreview, mergePeople } from "./people";

import { db } from "@/lib/db";
import { SLUG_RACE_MESSAGE, withReadableErrors } from "@/lib/db/errors";
import { compareWorks } from "@/lib/utils/title-order";
import { authors, workAuthors, editionContributors, countries, comments, activityEvents, galleryLayouts } from "@/lib/db/schema";
import { authorObjects, deleteUnusedObjects } from "@/lib/s3/cleanup";
import { eq, and, asc, desc, inArray, count, sql, isNotNull, min, max } from "drizzle-orm";
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
  updateAuthorSchema,
  type CreateAuthorInput,
  type UpdateAuthorInput,
} from "@/lib/validations";
import { parseId } from "@/lib/validations/helpers";
import { generateAuthorSlug } from "@/lib/utils/slugify";
import { refreshAuthorWorkSlugs } from "@/lib/works/slug";
import { computeZodiacSign } from "@/lib/utils/zodiac";
import { recordActivity } from "@/lib/activity/record";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import { posterTone, workReadingExtras } from "@/lib/actions/utils/work-card-query";
import { cleanBioForStorage, sanitizeDescriptionHtml } from "@/lib/utils/sanitize";
import { z } from "zod";

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
    collections?: string[];
    roles?: string[];
    favourites?: boolean;
  };
}) {
  const { search, limit = 48, offset = 0, order, filters } = opts ?? {};
  // Relevance only makes sense with a search term; fall back to name order
  const sort = opts?.sort === "relevance" && !search?.trim() ? "name" : (opts?.sort ?? "name");

  const filterConditions = await buildAuthorFilterConditions(filters);
  if (filterConditions === null) return [];

  // People of every collection; the collection filter narrows them
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
        country: { columns: { name: true, alpha2: true } },
        workAuthors: { columns: { workId: true } },
        media: {
          columns: { s3Key: true, thumbnailS3Key: true, type: true, isActive: true, cropX: true, cropY: true, cropZoom: true, brightness: true, contrast: true },
          extras: posterTone,
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
    orderBy: [...(Array.isArray(orderBy) ? orderBy : [orderBy]), asc(authors.id)],
    limit,
    offset,
    with: {
      country: { columns: { name: true, alpha2: true } },
      workAuthors: {
        columns: { workId: true },
      },
      media: {
        columns: { s3Key: true, thumbnailS3Key: true, type: true, isActive: true, cropX: true, cropY: true, cropZoom: true, brightness: true, contrast: true },
        extras: posterTone,
      },
    },
  });

  return results;
}

/**
 * Up to three book covers per author, for the cards of authors with no
 * portrait: their highest-rated works first, then the earliest. A work's
 * cover is its active poster, else its first edition's cover. Returns
 * `/api/s3/read` URLs by author id.
 */
export async function getAuthorCoverPreviews(
  authorIds: string[],
): Promise<Record<string, string[]>> {
  const ids = z.array(z.string().uuid()).max(200).parse(authorIds);
  if (!ids.length) return {};
  const result = await db.execute(sql`
    select author_id as "authorId", cover as "s3Key" from (
      select wa.author_id,
        coalesce(
          (select coalesce(m.thumbnail_s3_key, m.s3_key) from media m
            where m.work_id = w.id and m.type = 'poster' and m.is_active
            order by m.id limit 1),
          (select coalesce(e.thumbnail_s3_key, e.cover_s3_key) from editions e
            where e.work_id = w.id order by e.created_at, e.id limit 1)
        ) as cover,
        row_number() over (
          partition by wa.author_id
          order by w.rating desc nulls last, w.original_year nulls last, w.id
        ) as position
      from work_authors wa join works w on w.id = wa.work_id
      where wa.author_id = any(ARRAY[${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}]::uuid[])
    ) previews
    where position <= 3 and cover is not null
    order by author_id, position`);
  const found = (
    Array.isArray(result) ? result : (result as { rows: unknown[] }).rows
  ) as { authorId: string; s3Key: string }[];
  const byAuthor: Record<string, string[]> = {};
  for (const { authorId, s3Key } of found)
    (byAuthor[authorId] ??= []).push(`/api/s3/read?key=${encodeURIComponent(s3Key)}`);
  return byAuthor;
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
    collections?: string[];
    roles?: string[];
    favourites?: boolean;
  };
}) {
  const { search, filters } = opts ?? {};

  const filterConditions = await buildAuthorFilterConditions(filters);
  if (filterConditions === null) return 0;

  // People of every collection; the collection filter narrows them
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

/**
 * The roles of many people, in one grouped query (a card never asks for its
 * own): each person's roles with how many credits they hold in each.
 */
export async function getPersonRoles(
  personIds: string[],
): Promise<Record<string, PersonRole[]>> {
  const ids = [...new Set(personIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return {};
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = resultRows<{ personId: string; roleId: string; kind: WorkKind; label: string; count: number }>(
    await db.execute(sql`
      select c.person_id as "personId", r.id as "roleId", r.kind::text as kind, r.label, count(*)::int as count
      from (
        select wa.author_id as person_id, r.id as role_id from work_authors wa
          join credit_roles r on r.kind = 'book' and r.level = 'work' and r.legacy_role = wa.role
          where wa.author_id in (${list})
        union all
        select ec.author_id, r.id from edition_contributors ec
          join credit_roles r on r.kind = 'book' and r.level = 'edition' and r.legacy_role = ec.role
          where ec.author_id in (${list})
        union all
        select wc.person_id, wc.role_id from work_credits wc where wc.person_id in (${list})
        union all
        select p.person_id, 'perfume.perfumer' from perfume_variant_perfumers p where p.person_id in (${list})
      ) c
      join credit_roles r on r.id = c.role_id
      group by c.person_id, r.id, r.kind, r.label
    `),
  );
  const roles: Record<string, PersonRole[]> = {};
  for (const { personId, ...role } of rows) (roles[personId] ??= []).push(role);
  return roles;
}

/**
 * How many works each person is credited on, in every collection, in one
 * grouped query: books written or contributed to, films, perfumes and
 * paintings. Each work counts once.
 */
export async function getPersonWorkCounts(personIds: string[]): Promise<Record<string, number>> {
  const ids = [...new Set(personIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!ids.length) return {};
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = resultRows<{ personId: string; works: number }>(
    await db.execute(sql`
      select person_id as "personId", count(distinct work_id)::int as works from (
        select wa.author_id as person_id, wa.work_id from work_authors wa where wa.author_id in (${list})
        union all
        select ec.author_id, e.work_id from edition_contributors ec join editions e on e.id = ec.edition_id
          where ec.author_id in (${list})
        union all
        select wc.person_id, wc.work_id from work_credits wc where wc.person_id in (${list})
        union all
        select p.person_id, v.work_id from perfume_variant_perfumers p join perfume_variants v on v.id = p.variant_id
          where p.person_id in (${list})
      ) credits group by person_id
    `),
  );
  return Object.fromEntries(rows.map((r) => [r.personId, r.works]));
}

/** One work a person is credited on, with one of their roles on it */
export interface PersonWorkCredit {
  kind: WorkKind;
  roleId: string;
  role: string;
  workId: string;
  title: string;
  slug: string | null;
}

/**
 * Every work a person is credited on, in every collection, one row per work
 * and role: books they wrote or contributed to, films, perfumes (a variant's
 * own perfumers too) and paintings.
 */
export async function getPersonWorkCredits(personId: string): Promise<PersonWorkCredit[]> {
  return resultRows<PersonWorkCredit>(
    await db.execute(sql`
      select * from (
        select distinct w.kind::text as kind, r.id as "roleId", r.label as role, w.id as "workId", w.title, w.slug
      from (
        select c.work_id, c.role_id from work_credits c where c.person_id = ${personId}::uuid
        union
        select wa.work_id, r.id from work_authors wa
          join credit_roles r on r.kind = 'book' and r.level = 'work' and r.legacy_role = wa.role
          where wa.author_id = ${personId}::uuid
        union
        select e.work_id, r.id from edition_contributors ec join editions e on e.id = ec.edition_id
          join credit_roles r on r.kind = 'book' and r.level = 'edition' and r.legacy_role = ec.role
          where ec.author_id = ${personId}::uuid
        union
        select v.work_id, 'perfume.perfumer' from perfume_variant_perfumers p
          join perfume_variants v on v.id = p.variant_id where p.person_id = ${personId}::uuid
      ) c
      join works w on w.id = c.work_id
      join credit_roles r on r.id = c.role_id
      ) credits
      order by kind, lower(title), "workId", role
    `),
  );
}

/**
 * The People filters' choices, with how many people each holds: the
 * collections people belong to, and every role someone is credited with.
 */
export async function getPeopleFilterOptions() {
  const [collections, roles] = await Promise.all([
    db.execute(
      sql`select kind::text as kind, count(*)::int as count from person_domains group by kind order by kind`,
    ),
    db.execute(
      sql`select c.role_id as "roleId", cr.kind::text as kind, cr.label, count(distinct c.person_id)::int as count
        from ${PERSON_CREDITS} c join credit_roles cr on cr.id = c.role_id
        group by c.role_id, cr.kind, cr.label order by cr.kind, count(distinct c.person_id) desc, cr.label`,
    ),
  ]);
  return {
    collections: resultRows<{ kind: WorkKind; count: number }>(collections),
    roles: resultRows<{ roleId: string; kind: WorkKind; label: string; count: number }>(roles),
  };
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

/**
 * Bios are rendered as HTML (the author page, the bio editor) and sanitized
 * like book descriptions. Writes store them sanitized (cleanBioForStorage);
 * reads hand them out sanitized, whatever an older write stored.
 */
function withSafeBio<T extends { bio: string | null } | undefined>(author: T): T {
  if (author?.bio) author.bio = sanitizeDescriptionHtml(author.bio);
  return author;
}

export async function getAuthor(id: string) {
  const author = await db.query.authors.findFirst({
    where: eq(authors.id, id),
    with: {
      country: { columns: { name: true, alpha2: true } },
      birthPlace: { columns: { id: true, name: true, fullName: true } },
      deathPlace: { columns: { id: true, name: true, fullName: true } },
      workAuthors: {
        with: {
          work: {
            // Reading (SLN-449): the cards, "Read 7 of 12" and the Reading record
            extras: workReadingExtras,
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
  author?.workAuthors.sort((a, b) => compareWorks(a.work, b.work));
  return withSafeBio(author);
}

export async function getAuthorBySlug(slug: string) {
  const author = await db.query.authors.findFirst({
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
                extras: posterTone,
              },
              workAuthors: {
                with: { author: { columns: { name: true } } },
                orderBy: asc(workAuthors.sortOrder),
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
  author?.workAuthors.sort((a, b) => compareWorks(a.work, b.work));
  return withSafeBio(author);
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

  // The slug is decided first: the author and its slug are one statement
  const slug = await uniqueSlug(authors, generateAuthorSlug(parsed.name));
  const [author] = await withReadableErrors(
    () =>
      db
        .insert(authors)
        .values({ ...parsed, bio: cleanBioForStorage(parsed.bio), sortName, zodiacSign, slug })
        .returning(),
    { unique: SLUG_RACE_MESSAGE },
  );

  recordActivity("author", author.id, "author.created", { newValue: parsed.name });
  return author;
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

export async function updateAuthor(id: string, rawInput: UpdateAuthorInput) {
  parseId(id);
  const input = updateAuthorSchema.parse(rawInput);
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

  // A new name gives a new slug, decided first and written with the name
  const slug =
    input.name !== undefined && prev
      ? await uniqueSlug(authors, generateAuthorSlug(input.name), {
          own: prev.slug,
        })
      : undefined;
  const updatePayload = {
    ...input,
    ...(input.bio !== undefined ? { bio: cleanBioForStorage(input.bio) } : {}),
    ...(zodiacSign !== undefined ? { zodiacSign } : {}),
    ...(slug !== undefined ? { slug } : {}),
    updatedAt: new Date(),
  };

  await withReadableErrors(
    () => db.update(authors).set(updatePayload).where(eq(authors.id, id)),
    { unique: SLUG_RACE_MESSAGE },
  );

  if (input.name !== undefined) {
    // Book slugs carry the author's name
    if ((await refreshAuthorWorkSlugs(id)).length > 0) {
      invalidate(CACHE_TAGS.works, CACHE_TAGS.series);
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
      ["bio", "author.biography_changed", prev.bio, updatePayload.bio],
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
  // A person with no books (a director, a perfumer) goes through the shared
  // deletion, which refuses while they still have credits
  const [book] = await db
    .select({ id: authors.id })
    .from(authors)
    .where(and(bookPersonCondition, eq(authors.id, id)));
  if (!book) {
    await deletePerson(id);
    return { id, cleanupPending: false };
  }
  // Read the file keys first: the cascade removes the rows that name them.
  const stored = await authorObjects(id);
  // Keep the historical book deletion behavior, but a shared non-book credit
  // restricts deletion. Polymorphic cleanup must roll back with that rejection.
  const results = await atomic((d) => [
    d.execute(sql`select id from authors where id = ${id}::uuid for update`),
    d.execute(sql`select harmonization_assert(exists(select 1 from person_domains where person_id = ${id}::uuid and kind = 'book'), 'Book contributor not found')`),
    d.delete(comments).where(and(eq(comments.entityType, "author"), eq(comments.entityId, id))),
    d.delete(activityEvents).where(and(eq(activityEvents.entityType, "author"), eq(activityEvents.entityId, id))),
    d.delete(galleryLayouts).where(and(eq(galleryLayouts.entityType, "author"), eq(galleryLayouts.entityId, id))),
    d.delete(authors).where(and(bookPersonCondition, eq(authors.id, id))).returning({ id: authors.id }),
  ]);
  invalidate(CACHE_TAGS.authors, CACHE_TAGS.works, CACHE_TAGS.editions, CACHE_TAGS.activity, CACHE_TAGS.media);
  const deleted = (results.at(-1) as { id: string }[]).length > 0;
  const cleanupPending =
    deleted && (await deleteUnusedObjects(stored, `author ${id}`));
  return { id, cleanupPending };
}

/**
 * Merge source author into target author.
 * Uses the audited shared-person transaction: preserve distinct credit IDs,
 * metadata, media and redirects across domains; archive duplicate memberships.
 * Images the merge leaves unused are deleted after commit (see mergePeople).
 */
export async function mergeAuthors(sourceId: string, targetId: string) {
  const preview = await getPersonMergePreview(sourceId, targetId);
  const choices = Object.fromEntries(preview.fields.filter((field) => field.conflict).map((field) => [field.key, "target"]));
  await mergePeople({ sourceId, targetId, fingerprint: preview.fingerprint, choices });
  // Book slugs now carry the target author's name
  if ((await refreshAuthorWorkSlugs(targetId)).length > 0) {
    invalidate(CACHE_TAGS.works, CACHE_TAGS.series);
  }
  return { targetId, sourceName: preview.source.name, targetName: preview.target.name };
}
