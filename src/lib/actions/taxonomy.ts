"use server";

import { db } from "@/lib/db";
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
  workCategories,
  workThemes,
  workLiteraryMovements,
  workArtTypes,
  workArtMovements,
  workKeywords,
  workAttributes,
  works,
} from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";
import { cached, invalidate, CACHE_TAGS } from "@/lib/cache";

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

export async function createSubject(input: { name: string; slug: string }) {
  const [subject] = await db.insert(subjects).values(input).returning();
  invalidate(CACHE_TAGS.subjects);
  return subject;
}

export async function deleteSubject(id: string) {
  await db.delete(subjects).where(eq(subjects.id, id));
  invalidate(CACHE_TAGS.subjects);
  return { id };
}

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

export async function createGenre(input: {
  name: string;
  slug: string;
  parentId?: string | null;
  sortOrder?: number;
}) {
  const [genre] = await db.insert(genres).values(input).returning();
  invalidate(CACHE_TAGS.genres);
  return genre;
}

export async function updateGenre(
  id: string,
  input: Partial<{
    name: string;
    slug: string;
    parentId: string | null;
    sortOrder: number;
  }>,
) {
  await db.update(genres).set(input).where(eq(genres.id, id));
  invalidate(CACHE_TAGS.genres);
  return { id };
}

export async function deleteGenre(id: string) {
  await db.delete(genres).where(eq(genres.id, id));
  invalidate(CACHE_TAGS.genres);
  return { id };
}

// ── Tags ──────────────────────────────────────────────────────────────────────

export const getTags = cached(
  () => db.query.tags.findMany({ orderBy: asc(tags.name) }),
  ["tags"],
  [CACHE_TAGS.tags],
);

export async function createTag(input: { name: string; color?: string | null }) {
  const [tag] = await db.insert(tags).values(input).returning();
  invalidate(CACHE_TAGS.tags);
  return tag;
}

export async function updateTag(
  id: string,
  input: Partial<{ name: string; color: string | null }>,
) {
  await db.update(tags).set(input).where(eq(tags.id, id));
  invalidate(CACHE_TAGS.tags);
  return { id };
}

export async function deleteTag(id: string) {
  await db.delete(tags).where(eq(tags.id, id));
  invalidate(CACHE_TAGS.tags);
  return { id };
}

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
  input: {
    subjectIds?: string[];
    categoryIds?: string[];
    themeIds?: string[];
    literaryMovementIds?: string[];
    artTypeIds?: string[];
    artMovementIds?: string[];
    keywordIds?: string[];
    attributeIds?: string[];
  },
) {
  if (input.subjectIds !== undefined) {
    await db.delete(workSubjects).where(eq(workSubjects.workId, workId));
    if (input.subjectIds.length > 0) {
      await db.insert(workSubjects).values(
        input.subjectIds.map((subjectId) => ({ workId, subjectId })),
      );
    }
  }

  if (input.categoryIds !== undefined) {
    await db.delete(workCategories).where(eq(workCategories.workId, workId));
    if (input.categoryIds.length > 0) {
      await db.insert(workCategories).values(
        input.categoryIds.map((categoryId) => ({ workId, categoryId })),
      );
    }
  }

  if (input.themeIds !== undefined) {
    await db.delete(workThemes).where(eq(workThemes.workId, workId));
    if (input.themeIds.length > 0) {
      await db.insert(workThemes).values(
        input.themeIds.map((themeId) => ({ workId, themeId })),
      );
    }
  }

  if (input.literaryMovementIds !== undefined) {
    await db
      .delete(workLiteraryMovements)
      .where(eq(workLiteraryMovements.workId, workId));
    if (input.literaryMovementIds.length > 0) {
      await db.insert(workLiteraryMovements).values(
        input.literaryMovementIds.map((literaryMovementId) => ({
          workId,
          literaryMovementId,
        })),
      );
    }
  }

  if (input.artTypeIds !== undefined) {
    await db.delete(workArtTypes).where(eq(workArtTypes.workId, workId));
    if (input.artTypeIds.length > 0) {
      await db.insert(workArtTypes).values(
        input.artTypeIds.map((artTypeId) => ({ workId, artTypeId })),
      );
    }
  }

  if (input.artMovementIds !== undefined) {
    await db
      .delete(workArtMovements)
      .where(eq(workArtMovements.workId, workId));
    if (input.artMovementIds.length > 0) {
      await db.insert(workArtMovements).values(
        input.artMovementIds.map((artMovementId) => ({ workId, artMovementId })),
      );
    }
  }

  if (input.keywordIds !== undefined) {
    await db.delete(workKeywords).where(eq(workKeywords.workId, workId));
    if (input.keywordIds.length > 0) {
      await db.insert(workKeywords).values(
        input.keywordIds.map((keywordId) => ({ workId, keywordId })),
      );
    }
  }

  if (input.attributeIds !== undefined) {
    await db.delete(workAttributes).where(eq(workAttributes.workId, workId));
    if (input.attributeIds.length > 0) {
      await db.insert(workAttributes).values(
        input.attributeIds.map((attributeId) => ({ workId, attributeId })),
      );
    }
  }

  await db
    .update(works)
    .set({ updatedAt: new Date() })
    .where(eq(works.id, workId));

  invalidate(CACHE_TAGS.works);
  return { workId };
}
