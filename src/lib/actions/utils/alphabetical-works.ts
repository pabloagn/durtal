
import { bookCondition } from "@/lib/catalogue/book-boundary";
import { and, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { works } from "@/lib/db/schema";
import { compareWorks } from "@/lib/utils/title-order";

/**
 * Sort lightweight IDs/titles before paging, then load card relations only for
 * that page. This shares the exact same natural order as in-memory detail lists
 * without depending on the database's locale or loading every work's artwork.
 */
export async function alphabeticalWorkIds(
  where: SQL | undefined,
  limit: number,
  offset = 0,
  order: "asc" | "desc" = "asc",
) {
  const matches = await db
    .select({ id: works.id, title: works.title })
    .from(works)
    .where(and(bookCondition, where));
  return matches
    .sort((a, b) => compareWorks(a, b, order))
    .slice(offset, offset + limit)
    .map((work) => work.id);
}
