import { sql, type SQL } from "drizzle-orm";

/**
 * Only these legacy credit junctions have a UUID in addition to their compound
 * key. Called after the merge executor locks the tables and archives all rows.
 * Duplicate memberships keep the target credit; distinct credits keep their IDs.
 */
export function bookCreditMergeQueries(
  table: string,
  column: string,
  sourceId: string,
  targetId: string,
): SQL[] | undefined {
  if (table === "work_authors" && column === "author_id")
    return [
      sql`delete from work_authors s using work_authors t where s.author_id = ${sourceId}::uuid and t.author_id = ${targetId}::uuid and s.work_id = t.work_id and s.role = t.role`,
      sql`update work_authors set author_id = ${targetId}::uuid where author_id = ${sourceId}::uuid`,
    ];
  if (table === "work_authors" && column === "work_id")
    return [
      sql`delete from work_authors s using work_authors t where s.work_id = ${sourceId}::uuid and t.work_id = ${targetId}::uuid and s.author_id = t.author_id and s.role = t.role`,
      sql`update work_authors set work_id = ${targetId}::uuid where work_id = ${sourceId}::uuid`,
    ];
  if (table === "edition_contributors" && column === "author_id")
    return [
      sql`delete from edition_contributors s using edition_contributors t where s.author_id = ${sourceId}::uuid and t.author_id = ${targetId}::uuid and s.edition_id = t.edition_id and s.role = t.role`,
      sql`update edition_contributors set author_id = ${targetId}::uuid where author_id = ${sourceId}::uuid`,
    ];
  if (table === "work_authors" || table === "edition_contributors")
    throw new Error(
      "This book-credit relationship requires a dedicated merge strategy",
    );
  return undefined;
}
