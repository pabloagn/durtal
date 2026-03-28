"use server";

import { db } from "@/lib/db";
import { subjects, genres, tags } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

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
