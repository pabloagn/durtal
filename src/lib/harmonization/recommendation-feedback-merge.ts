import { sql, type SQL } from "drizzle-orm";

/**
 * Moves the merged book's suggestion feedback (recommendation_feedback) to
 * the kept book (SLN-457). A book has at most one row, so when both books
 * have one the newer verdict wins: the older row (by updated_at, then id)
 * goes first, then the rest moves.
 */
export function recommendationFeedbackMergeQueries(sourceId: string, targetId: string): SQL[] {
  const s = sql`${sourceId}::uuid`;
  const t = sql`${targetId}::uuid`;
  return [
    sql`delete from recommendation_feedback f using recommendation_feedback k
      where f.work_id in (${s}, ${t}) and k.work_id in (${s}, ${t}) and f.id <> k.id
      and (f.updated_at < k.updated_at or (f.updated_at = k.updated_at and f.id < k.id))`,
    sql`update recommendation_feedback set work_id = ${t} where work_id = ${s}`,
  ];
}
