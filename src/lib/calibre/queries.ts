import { db } from "@/lib/db";
import { calibreBooks } from "@/lib/db/schema/calibre-books";
import { readingProgress } from "@/lib/db/schema/reading-progress";
import { eq, ilike, or, desc, asc, count, inArray } from "drizzle-orm";

// ── Types ────────────────────────────────────────────────────────────────────

export interface CalibreBookFormat {
  format: string;
  fileName: string;
  sizeBytes: number;
  s3Key: string;
}

export interface CalibreBookRow {
  id: string;
  calibreId: number;
  title: string;
  authorSort: string | null;
  path: string;
  hasCover: boolean;
  coverS3Key: string | null;
  isbn: string | null;
  formats: CalibreBookFormat[] | null;
  pubdate: string | null;
  workId: string | null;
  lastSynced: Date;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export async function getCalibreBooks(opts: {
  query?: string;
  limit?: number;
  offset?: number;
  sort?: "title" | "recent";
}): Promise<{ books: CalibreBookRow[]; total: number }> {
  const { query, limit = 50, offset = 0, sort = "title" } = opts;

  const conditions = query
    ? or(
        ilike(calibreBooks.title, `%${query}%`),
        ilike(calibreBooks.authorSort, `%${query}%`),
      )
    : undefined;

  const orderBy =
    sort === "recent"
      ? desc(calibreBooks.lastSynced)
      : asc(calibreBooks.title);

  const [books, [{ total }]] = await Promise.all([
    db
      .select()
      .from(calibreBooks)
      .where(conditions)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(calibreBooks)
      .where(conditions),
  ]);

  return {
    books: books as CalibreBookRow[],
    total,
  };
}

export async function getCalibreBookById(
  calibreId: number,
): Promise<CalibreBookRow | null> {
  const [book] = await db
    .select()
    .from(calibreBooks)
    .where(eq(calibreBooks.calibreId, calibreId))
    .limit(1);

  return (book as CalibreBookRow) ?? null;
}

export async function getCalibreBookByDbId(
  id: string,
): Promise<CalibreBookRow | null> {
  const [book] = await db
    .select()
    .from(calibreBooks)
    .where(eq(calibreBooks.id, id))
    .limit(1);

  return (book as CalibreBookRow) ?? null;
}

export async function getReadingProgress(calibreBookId: string) {
  const [progress] = await db
    .select()
    .from(readingProgress)
    .where(eq(readingProgress.calibreBookId, calibreBookId))
    .limit(1);

  return progress ?? null;
}

export async function upsertReadingProgress(data: {
  calibreBookId: string;
  currentCfi?: string;
  currentPage?: number;
  progressPercent?: number;
  currentChapter?: string;
}) {
  const now = new Date();

  // Build update set conditionally — only overwrite fields that were actually provided
  const updateSet: Record<string, unknown> = { lastReadAt: now, updatedAt: now };
  if (data.currentCfi !== undefined) updateSet.currentCfi = data.currentCfi;
  if (data.currentPage !== undefined) updateSet.currentPage = data.currentPage;
  if (data.progressPercent !== undefined) updateSet.progressPercent = data.progressPercent;
  if (data.currentChapter !== undefined) updateSet.currentChapter = data.currentChapter;

  await db
    .insert(readingProgress)
    .values({
      ...data,
      startedAt: now,
      lastReadAt: now,
    })
    .onConflictDoUpdate({
      target: readingProgress.calibreBookId,
      set: updateSet,
    });
}

/** Get calibre books linked to a specific Durtal work */
export async function getCalibreBooksByWorkId(
  workId: string,
): Promise<CalibreBookRow[]> {
  const books = await db
    .select()
    .from(calibreBooks)
    .where(eq(calibreBooks.workId, workId))
    .orderBy(asc(calibreBooks.title));

  return books as CalibreBookRow[];
}

/** Check which work IDs have linked calibre books (for badge display) */
export async function getWorkIdsWithDigitalEditions(
  workIds: string[],
): Promise<Set<string>> {
  if (workIds.length === 0) return new Set();

  const rows = await db
    .selectDistinct({ workId: calibreBooks.workId })
    .from(calibreBooks)
    .where(inArray(calibreBooks.workId, workIds));

  return new Set(rows.map((r) => r.workId).filter(Boolean) as string[]);
}

/** Get books with recent reading activity */
export async function getRecentlyRead(limit = 10) {
  return db
    .select({
      progress: readingProgress,
      book: calibreBooks,
    })
    .from(readingProgress)
    .innerJoin(calibreBooks, eq(readingProgress.calibreBookId, calibreBooks.id))
    .orderBy(desc(readingProgress.lastReadAt))
    .limit(limit);
}

