import { and, asc, eq, like } from "drizzle-orm";
import { bookCondition } from "@/lib/catalogue/book-boundary";
import { db } from "@/lib/db";
import { workAuthors, works } from "@/lib/db/schema";
import { generateWorkSlug, makeUnique } from "@/lib/utils/slugify";

/**
 * A work's slug follows its title and primary author (task 0175b). A rename
 * of the work, a new primary author, an author rename or an author merge
 * refreshes it. A slug that matches the current title and author is left
 * alone, so a numbered slug ("...-2") keeps its number.
 */

export interface SlugChange {
  id: string;
  title: string;
  from: string | null;
  to: string;
}

/** True when `slug` is `base` or `base` with a uniqueness number. */
export function slugFitsBase(slug: string | null, base: string): boolean {
  if (!slug) return false;
  if (slug === base) return true;
  return slug.startsWith(`${base}-`) && /^\d+$/.test(slug.slice(base.length + 1));
}

/**
 * The slug change a work needs, or null when its slug already fits. With
 * `apply`, the new slug is written. The work's own slug never counts as taken.
 */
export async function refreshWorkSlug(
  workId: string,
  { apply = true }: { apply?: boolean } = {},
): Promise<SlugChange | null> {
  // Only books have a primary author in their URL; other domains keep theirs.
  const work = await db.query.works.findFirst({
    where: and(bookCondition, eq(works.id, workId)),
    columns: { id: true, title: true, slug: true },
    with: {
      workAuthors: {
        columns: {},
        with: { author: { columns: { name: true } } },
        orderBy: asc(workAuthors.sortOrder),
        limit: 1,
      },
    },
  });
  if (!work) return null;

  const base = generateWorkSlug(
    work.title,
    work.workAuthors[0]?.author.name ?? "unknown",
    work.id,
  );
  if (slugFitsBase(work.slug, base)) return null;

  const taken = (
    await db
      .select({ slug: works.slug })
      .from(works)
      .where(like(works.slug, `${base}%`))
  )
    .map((r) => r.slug)
    .filter((s): s is string => s !== null && s !== work.slug);
  const to = makeUnique(base, taken);

  if (apply) await db.update(works).set({ slug: to }).where(eq(works.id, workId));
  return { id: work.id, title: work.title, from: work.slug, to };
}

/** Refreshes the slugs of every work an author is linked to. */
export async function refreshAuthorWorkSlugs(
  authorId: string,
): Promise<SlugChange[]> {
  const links = await db
    .selectDistinct({ workId: workAuthors.workId })
    .from(workAuthors)
    .where(eq(workAuthors.authorId, authorId));
  const changes: SlugChange[] = [];
  for (const { workId } of links) {
    const change = await refreshWorkSlug(workId);
    if (change) changes.push(change);
  }
  return changes;
}
