import { and, eq, not, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { workAuthors, editionContributors } from "@/lib/db/schema";

type Connection = typeof db;

/** Legacy forms edit membership/order, leaving attribution and stable IDs alone. */
export function bookAuthorQueries(
  d: Connection,
  workId: string,
  credits: { authorId: string; role?: string }[],
) {
  const entries = credits.map((credit, sortOrder) => ({
    workId,
    authorId: credit.authorId,
    role: credit.role ?? "author",
    sortOrder,
  }));
  const keep = entries.length
    ? or(
        ...entries.map((credit) =>
          and(
            eq(workAuthors.authorId, credit.authorId),
            eq(workAuthors.role, credit.role),
          ),
        ),
      )
    : undefined;
  return [
    d.execute(sql`select id from works where id = ${workId}::uuid for update`),
    d
      .delete(workAuthors)
      .where(and(eq(workAuthors.workId, workId), keep ? not(keep) : undefined)),
    ...(entries.length
      ? [
          d
            .insert(workAuthors)
            .values(entries)
            .onConflictDoUpdate({
              target: [
                workAuthors.workId,
                workAuthors.authorId,
                workAuthors.role,
              ],
              set: { sortOrder: sql`excluded.sort_order` },
            }),
        ]
      : []),
  ];
}

export function editionContributorQueries(
  d: Connection,
  editionId: string,
  credits: { authorId: string; role: string }[],
) {
  const entries = credits.map((credit, sortOrder) => ({
    editionId,
    ...credit,
    sortOrder,
  }));
  const keep = entries.length
    ? or(
        ...entries.map((credit) =>
          and(
            eq(editionContributors.authorId, credit.authorId),
            eq(editionContributors.role, credit.role),
          ),
        ),
      )
    : undefined;
  return [
    d.execute(
      sql`select id from editions where id = ${editionId}::uuid for update`,
    ),
    d
      .delete(editionContributors)
      .where(
        and(
          eq(editionContributors.editionId, editionId),
          keep ? not(keep) : undefined,
        ),
      ),
    ...(entries.length
      ? [
          d
            .insert(editionContributors)
            .values(entries)
            .onConflictDoUpdate({
              target: [
                editionContributors.editionId,
                editionContributors.authorId,
                editionContributors.role,
              ],
              set: { sortOrder: sql`excluded.sort_order` },
            }),
        ]
      : []),
  ];
}
