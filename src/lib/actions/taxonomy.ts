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

// ── Work Types ────────────────────────────────────────────────────────────────

export async function getWorkTypes() {
  return db.query.workTypes.findMany({ orderBy: asc(workTypes.name) });
}

// ── Subjects ─────────────────────────────────────────────────────────────────

export async function getSubjects() {
  return db.query.subjects.findMany({
    orderBy: asc(subjects.name),
  });
}

export async function createSubject(input: { name: string; slug: string }) {
  const [subject] = await db.insert(subjects).values(input).returning();
  return subject;
}

export async function deleteSubject(id: string) {
  await db.delete(subjects).where(eq(subjects.id, id));
  return { id };
}

// ── Genres ────────────────────────────────────────────────────────────────────

export async function getGenres() {
  return db.query.genres.findMany({
    orderBy: asc(genres.sortOrder),
    with: {
      parent: true,
      children: true,
    },
  });
}

export async function createGenre(input: {
  name: string;
  slug: string;
  parentId?: string | null;
  sortOrder?: number;
}) {
  const [genre] = await db.insert(genres).values(input).returning();
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
  return { id };
}

export async function deleteGenre(id: string) {
  await db.delete(genres).where(eq(genres.id, id));
  return { id };
}

// ── Tags ──────────────────────────────────────────────────────────────────────

export async function getTags() {
  return db.query.tags.findMany({
    orderBy: asc(tags.name),
  });
}

export async function createTag(input: { name: string; color?: string | null }) {
  const [tag] = await db.insert(tags).values(input).returning();
  return tag;
}

export async function updateTag(
  id: string,
  input: Partial<{ name: string; color: string | null }>,
) {
  await db.update(tags).set(input).where(eq(tags.id, id));
  return { id };
}

export async function deleteTag(id: string) {
  await db.delete(tags).where(eq(tags.id, id));
  return { id };
}

// ── Categories ────────────────────────────────────────────────────────────────

export async function getCategories() {
  return db.query.bookCategories.findMany({
    orderBy: asc(bookCategories.sortOrder),
    with: { parent: true, children: true },
  });
}

// ── Themes ────────────────────────────────────────────────────────────────────

export async function getThemes() {
  return db.query.themes.findMany({
    orderBy: asc(themes.sortOrder),
    with: { parent: true, children: true },
  });
}

// ── Literary Movements ────────────────────────────────────────────────────────

export async function getLiteraryMovements() {
  return db.query.literaryMovements.findMany({
    orderBy: asc(literaryMovements.sortOrder),
    with: { parent: true, children: true },
  });
}

// ── Art Types ─────────────────────────────────────────────────────────────────

export async function getArtTypes() {
  return db.query.artTypes.findMany({
    orderBy: asc(artTypes.name),
  });
}

// ── Art Movements ─────────────────────────────────────────────────────────────

export async function getArtMovements() {
  return db.query.artMovements.findMany({
    orderBy: asc(artMovements.name),
  });
}

// ── Keywords ──────────────────────────────────────────────────────────────────

export async function getKeywords() {
  return db.query.keywords.findMany({
    orderBy: asc(keywords.name),
  });
}

// ── Attributes ────────────────────────────────────────────────────────────────

export async function getAttributes() {
  return db.query.attributes.findMany({
    orderBy: asc(attributes.name),
  });
}

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

  return { workId };
}
