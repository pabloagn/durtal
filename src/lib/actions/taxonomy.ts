"use server";

import {
  bookReferenceCondition,
  requireBookWork,
} from "@/lib/catalogue/book-boundary";

import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { assertSql } from "@/lib/harmonization/store";
import { workTaxonomyQueries } from "@/lib/catalogue/work-taxonomy";
import {
  subjects,
  genres,
  tags,
  workTypes,
  bookCategories,
  themes,
  literaryMovements,
  artTypes,
  artMovements,
  keywords,
  attributes,
  workSubjects,
  works,
} from "@/lib/db/schema";
import { eq, asc, sql, and } from "drizzle-orm";
import { cached, invalidate, CACHE_TAGS } from "@/lib/cache";
import { recordActivity } from "@/lib/activity/record";
import {
  updateWorkTaxonomySchema,
  type UpdateWorkTaxonomyInput,
} from "@/lib/validations/taxonomy-management";
import { parseId } from "@/lib/validations/helpers";

// ── Work Types ────────────────────────────────────────────────────────────────

export const getWorkTypes = cached(
  () => db.query.workTypes.findMany({ orderBy: asc(workTypes.name) }),
  ["work-types"],
  [CACHE_TAGS.workTypes],
);

// ── Subjects ─────────────────────────────────────────────────────────────────

export const getSubjects = cached(
  () => db.query.subjects.findMany({ orderBy: asc(subjects.name) }),
  ["subjects"],
  [CACHE_TAGS.subjects],
);

export const getSubjectsWithWorkCounts = cached(
  async () => {
    const rows = await db
      .select({
        id: subjects.id,
        name: subjects.name,
        slug: subjects.slug,
        description: subjects.description,
        workCount: sql<number>`count(${workSubjects.workId})::int`,
      })
      .from(subjects)
      .leftJoin(
        workSubjects,
        and(
          eq(subjects.id, workSubjects.subjectId),
          bookReferenceCondition(workSubjects.workId),
        ),
      )
      .groupBy(subjects.id)
      .orderBy(asc(subjects.name));
    return rows;
  },
  ["subjects-with-counts"],
  [CACHE_TAGS.subjects, CACHE_TAGS.works],
);

// ── Genres ────────────────────────────────────────────────────────────────────

export const getGenres = cached(
  () =>
    db.query.genres.findMany({
      orderBy: asc(genres.sortOrder),
      with: { parent: true, children: true },
    }),
  ["genres"],
  [CACHE_TAGS.genres],
);

// ── Tags ──────────────────────────────────────────────────────────────────────

export const getTags = cached(
  () => db.query.tags.findMany({ orderBy: asc(tags.name) }),
  ["tags"],
  [CACHE_TAGS.tags],
);

// ── Categories ────────────────────────────────────────────────────────────────

export const getCategories = cached(
  () =>
    db.query.bookCategories.findMany({
      orderBy: asc(bookCategories.sortOrder),
      with: { parent: true, children: true },
    }),
  ["categories"],
  [CACHE_TAGS.categories],
);

// ── Themes ────────────────────────────────────────────────────────────────────

export const getThemes = cached(
  () =>
    db.query.themes.findMany({
      orderBy: asc(themes.sortOrder),
      with: { parent: true, children: true },
    }),
  ["themes"],
  [CACHE_TAGS.themes],
);

// ── Literary Movements ────────────────────────────────────────────────────────

export const getLiteraryMovements = cached(
  () =>
    db.query.literaryMovements.findMany({
      orderBy: asc(literaryMovements.sortOrder),
      with: { parent: true, children: true },
    }),
  ["literary-movements"],
  [CACHE_TAGS.literaryMovements],
);

// ── Art Types ─────────────────────────────────────────────────────────────────

export const getArtTypes = cached(
  () => db.query.artTypes.findMany({ orderBy: asc(artTypes.name) }),
  ["art-types"],
  [CACHE_TAGS.artTypes],
);

// ── Art Movements ─────────────────────────────────────────────────────────────

export const getArtMovements = cached(
  () => db.query.artMovements.findMany({ orderBy: asc(artMovements.name) }),
  ["art-movements"],
  [CACHE_TAGS.artMovements],
);

// ── Keywords ──────────────────────────────────────────────────────────────────

export const getKeywords = cached(
  () => db.query.keywords.findMany({ orderBy: asc(keywords.name) }),
  ["keywords"],
  [CACHE_TAGS.keywords],
);

// ── Attributes ────────────────────────────────────────────────────────────────

export const getAttributes = cached(
  () => db.query.attributes.findMany({ orderBy: asc(attributes.name) }),
  ["attributes"],
  [CACHE_TAGS.attributes],
);

// ── Update Work Taxonomy ──────────────────────────────────────────────────────

export async function updateWorkTaxonomy(
  workId: string,
  rawInput: UpdateWorkTaxonomyInput,
) {
  parseId(workId);
  const input = updateWorkTaxonomySchema.parse(rawInput);
  await requireBookWork(workId);
  await atomic((d) => [
    d.execute(sql`select id from works where id=${workId}::uuid for update`),
    d.execute(
      assertSql(
        sql`exists(select 1 from works where id=${workId}::uuid and kind='book')`,
        "Book not found",
      ),
    ),
    ...workTaxonomyQueries(d, workId, input),
    d.update(works).set({ updatedAt: new Date() }).where(eq(works.id, workId)),
  ]);

  recordActivity("work", workId, "work.taxonomy_added", {
    extra: { updated: true },
  });

  invalidate(CACHE_TAGS.works);
  return { workId };
}
