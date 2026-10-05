import { sql, type SQL } from "drizzle-orm";

/**
 * Moves the merged book's Up Next row (reading_queue) to the kept book (SLN-452).
 * A book is queued at most once, so when both are queued the row with the
 * later position goes and the earlier one keeps its place, note and edition.
 * Called after the merge executor moved the editions, so a queued edition of
 * the merged book already belongs to the kept one and passes the guard.
 */
export function readingQueueMergeQueries(sourceId: string, targetId: string): SQL[] {
  const s = sql`${sourceId}::uuid`;
  const t = sql`${targetId}::uuid`;
  return [
    sql`delete from reading_queue q using reading_queue k
      where q.work_id in (${s}, ${t}) and k.work_id in (${s}, ${t}) and q.id <> k.id
      and (q.position > k.position or (q.position = k.position and q.work_id = ${s}))`,
    sql`update reading_queue set work_id = ${t} where work_id = ${s}`,
  ];
}
