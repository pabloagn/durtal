/**
 * Regenerate slugs for all works and authors.
 *
 * Run after fixing the slugify function:
 *   npx tsx src/lib/db/backfill-slugs.ts
 *
 * Regenerates ALL slugs (not just null ones) to fix bad characters.
 */

import { db } from "@/lib/db";
import { works, authors, workAuthors } from "@/lib/db/schema";
import { eq, asc, like } from "drizzle-orm";
import { generateWorkSlug, generateAuthorSlug, makeUnique } from "@/lib/utils/slugify";

async function backfillAuthors() {
  console.log("Regenerating author slugs…");

  const allAuthors = await db.query.authors.findMany({
    columns: { id: true, name: true, slug: true },
    orderBy: asc(authors.name),
  });

  console.log(`  Found ${allAuthors.length} authors`);

  let updated = 0;
  for (const author of allAuthors) {
    const baseSlug = generateAuthorSlug(author.name);

    // Fetch existing slugs with the same prefix to check uniqueness
    // Exclude own row so we don't collide with ourselves
    const existing = await db
      .select({ slug: authors.slug })
      .from(authors)
      .where(like(authors.slug, `${baseSlug}%`));

    const existingSlugs = existing
      .map((r) => r.slug)
      .filter((s): s is string => s !== null && s !== author.slug);

    const slug = makeUnique(baseSlug, existingSlugs);

    if (slug !== author.slug) {
      await db.update(authors).set({ slug }).where(eq(authors.id, author.id));
      console.log(`  author: "${author.name}" → ${slug}${author.slug ? ` (was: ${author.slug})` : ""}`);
      updated++;
    }
  }

  console.log(`Author slug regeneration complete. Updated ${updated}/${allAuthors.length}.`);
}

async function backfillWorks() {
  console.log("Regenerating work slugs…");

  const allWorks = await db.query.works.findMany({
    columns: { id: true, title: true, slug: true },
    with: {
      workAuthors: {
        with: { author: { columns: { name: true } } },
        orderBy: asc(workAuthors.sortOrder),
        limit: 1,
      },
    },
    orderBy: asc(works.title),
  });

  console.log(`  Found ${allWorks.length} works`);

  let updated = 0;
  for (const work of allWorks) {
    const authorName = work.workAuthors[0]?.author.name ?? "unknown";
    const baseSlug = generateWorkSlug(work.title, authorName, work.id);

    const existing = await db
      .select({ slug: works.slug })
      .from(works)
      .where(like(works.slug, `${baseSlug}%`));

    const existingSlugs = existing
      .map((r) => r.slug)
      .filter((s): s is string => s !== null && s !== work.slug);

    const slug = makeUnique(baseSlug, existingSlugs);

    if (slug !== work.slug) {
      await db.update(works).set({ slug }).where(eq(works.id, work.id));
      console.log(`  work: "${work.title}" → ${slug}${work.slug ? ` (was: ${work.slug})` : ""}`);
      updated++;
    }
  }

  console.log(`Work slug regeneration complete. Updated ${updated}/${allWorks.length}.`);
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
