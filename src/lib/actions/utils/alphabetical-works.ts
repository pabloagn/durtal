
import { bookCondition } from "@/lib/catalogue/book-boundary";
import { and, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { works } from "@/lib/db/schema";
import { compareWorks } from "@/lib/utils/title-order";

/**
 * Sort lightweight IDs/titles before paging, then load card relations only for
 * that page. This shares the exact same natural order as in-memory detail lists
 * without depending on the database's locale or loading every work's artwork.
 * The domain condition defaults to books; other domains pass their own.
 */
export async function alphabeticalWorkIds(
  where: SQL | undefined,
  limit: number,
  offset = 0,
  order: "asc" | "desc" = "asc",
  domain: SQL = bookCondition,
) {
  return (await alphabeticalWorkPage(where, limit, offset, order, domain)).ids;
}

/** `alphabeticalWorkIds` with how many works match: the one read gives both */
export async function alphabeticalWorkPage(
  where: SQL | undefined,
  limit: number,
  offset = 0,
  order: "asc" | "desc" = "asc",
  domain: SQL = bookCondition,
) {
  const matches = await db
    .select({ id: works.id, title: works.title })
    .from(works)
    .where(and(domain, where));
  const ids = matches
    .sort((a, b) => compareWorks(a, b, order))
    .slice(offset, offset + limit)
    .map((work) => work.id);
  return { ids, total: matches.length };
}
