import { eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { authors, works, type series, type taxonomyFamilies } from "@/lib/db/schema";
import { generateWorkSlug, makeUnique } from "@/lib/utils/slugify";

/**
 * The fixed pages beside a work's own page: /library/new, /library/import,
 * /library/identify, /films/new, /perfumes/new, /paintings/new. A work never
 * takes one of these slugs, or its page would sit behind that page
 * (SLN-1287). Every kind shares the one `works.slug` column.
 */
export const RESERVED_WORK_SLUGS = ["new", "import", "identify"] as const;

/**
 * A slug no other row of the table uses: "base", or "base-2" and on. A row
 * that keeps its own slug passes it as `own`, so that slug never counts as
 * taken; slugs already chosen for other new rows of the same write go in
 * `taken`. A work's slug is never one of `RESERVED_WORK_SLUGS`. Decided
 * before the write, so the row and its slug are one statement.
 */
export async function uniqueSlug(
  table:
    | typeof works
    | typeof authors
    | typeof series
    | typeof taxonomyFamilies,
  base: string,
  { own, taken = [] }: { own?: string | null; taken?: Iterable<string> } = {},
  conn: Pick<typeof db, "select"> = db,
) {
  const rows = await conn
    .select({ slug: table.slug })
    .from(table)
    .where(like(table.slug, `${base}%`));
  return makeUnique(base, [
    ...rows.flatMap((row) => (row.slug && row.slug !== own ? [row.slug] : [])),
    ...taken,
    ...(table === works ? RESERVED_WORK_SLUGS : []),
  ]);
}

/**
 * The address of a new film or painting: `{title}-by-{name}` for the first
 * credit in `roleId` (by name, or as credited; the title alone without one),
 * numbered when taken, like a book's. If another work takes it during the
 * write, the caller tries the next attempt; the third adds the work's id.
 * Renames keep the address.
 */
export async function creditedWorkSlug(
  id: string,
  title: string,
  credits: { roleId: string; personId: string | null; creditedAs: string | null }[],
  roleId: string,
  attempt: number,
) {
  const credit = credits.find((c) => c.roleId === roleId && (c.personId || c.creditedAs));
  const name = credit?.personId
    ? ((
        await db.query.authors.findFirst({
          where: eq(authors.id, credit.personId),
          columns: { name: true },
        })
      )?.name ??
      credit.creditedAs ??
      "")
    : (credit?.creditedAs ?? "");
  const base = generateWorkSlug(title, name, id);
  return attempt < 2 ? uniqueSlug(works, base) : `${base}-${id}`;
}
