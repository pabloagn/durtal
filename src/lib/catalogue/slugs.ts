import { like } from "drizzle-orm";
import { db } from "@/lib/db";
import type { authors, series, works } from "@/lib/db/schema";
import { makeUnique } from "@/lib/utils/slugify";

/**
 * A slug no other row of the table uses: "base", or "base-2" and on. A row
 * that keeps its own slug passes it as `own`, so that slug never counts as
 * taken; slugs already chosen for other new rows of the same write go in
 * `taken`. Decided before the write, so the row and its slug are one statement.
 */
export async function uniqueSlug(
  table: typeof works | typeof authors | typeof series,
  base: string,
  { own, taken = [] }: { own?: string | null; taken?: Iterable<string> } = {},
) {
  const rows = await db
    .select({ slug: table.slug })
    .from(table)
    .where(like(table.slug, `${base}%`));
  return makeUnique(base, [
    ...rows.flatMap((row) => (row.slug && row.slug !== own ? [row.slug] : [])),
    ...taken,
  ]);
}
