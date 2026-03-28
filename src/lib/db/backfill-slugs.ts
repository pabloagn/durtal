/**
 * Backfill slugs for all existing works and authors.
 *
 * Run once after the 0004 migration:
 *   npx tsx src/lib/db/backfill-slugs.ts
 *
 * Safe to re-run: rows that already have a slug are skipped.
 */

import { db } from "@/lib/db";
import { works, authors, workAuthors } from "@/lib/db/schema";
import { eq, asc, like, isNull } from "drizzle-orm";
import { generateWorkSlug, generateAuthorSlug, makeUnique } from "@/lib/utils/slugify";

async function backfillAuthors() {
  console.log("Backfilling author slugs…");

  const allAuthors = await db.query.authors.findMany({
    where: isNull(authors.slug),
    columns: { id: true, name: true },
  });

  console.log(`  Found ${allAuthors.length} authors without a slug`);

  for (const author of allAuthors) {
    const baseSlug = generateAuthorSlug(author.name);

    // Fetch existing slugs with the same prefix to check uniqueness
    const existing = await db
      .select({ slug: authors.slug })
      .from(authors)
      .where(like(authors.slug, `${baseSlug}%`));

    const existingSlugs = existing
      .map((r) => r.slug)
      .filter((s): s is string => s !== null);

    const slug = makeUnique(baseSlug, existingSlugs);

    await db.update(authors).set({ slug }).where(eq(authors.id, author.id));
    console.log(`  author: "${author.name}" → ${slug}`);
  }

  console.log("Author slug backfill complete.");
}

async function backfillWorks() {
  console.log("Backfilling work slugs…");

  const allWorks = await db.query.works.findMany({
    where: isNull(works.slug),
    columns: { id: true, title: true },
    with: {
      workAuthors: {
        with: { author: { columns: { name: true } } },
        orderBy: asc(workAuthors.sortOrder),
        limit: 1,
      },
    },
  });

  console.log(`  Found ${allWorks.length} works without a slug`);

  for (const work of allWorks) {
    const authorName = work.workAuthors[0]?.author.name ?? "unknown";
    const baseSlug = generateWorkSlug(work.title, authorName, work.id);

    const existing = await db
      .select({ slug: works.slug })
      .from(works)
      .where(like(works.slug, `${baseSlug}%`));

    const existingSlugs = existing
      .map((r) => r.slug)
      .filter((s): s is string => s !== null);

    const slug = makeUnique(baseSlug, existingSlugs);

    await db.update(works).set({ slug }).where(eq(works.id, work.id));
    console.log(`  work: "${work.title}" → ${slug}`);
  }

  console.log("Work slug backfill complete.");
}

async function main() {
  await backfillAuthors();
  await backfillWorks();
  console.log("All done.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
