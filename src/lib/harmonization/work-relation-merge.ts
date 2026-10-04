import { sql, type SQL } from "drizzle-orm";

/**
 * Moves the merged work's links (work_relations) to the kept work. Called
 * after the merge executor locks the tables and archives all rows. A link
 * between the two works would point at itself, so it goes; a link the kept
 * work already has to the same work, of the same type, keeps the kept one.
 * Both works have one kind (merges join works of one kind), so each moved
 * end keeps a valid kind.
 */
export function workRelationMergeQueries(sourceId: string, targetId: string): SQL[] {
  const s = sql`${sourceId}::uuid`;
  const t = sql`${targetId}::uuid`;
  // The other end of a link, seen from one of its works
  const other = (alias: string, own: SQL) =>
    sql.raw(`case when ${alias}.from_work_id = `).append(own).append(sql.raw(` then ${alias}.to_work_id else ${alias}.from_work_id end`));
  return [
    sql`delete from work_relations where (from_work_id = ${s} and to_work_id = ${t}) or (from_work_id = ${t} and to_work_id = ${s})`,
    sql`delete from work_relations m using work_relations k
      where (m.from_work_id = ${s} or m.to_work_id = ${s})
      and (k.from_work_id = ${t} or k.to_work_id = ${t})
      and m.type = k.type and ${other("m", s)} = ${other("k", t)}`,
    sql`update work_relations set from_work_id = ${t} where from_work_id = ${s}`,
    sql`update work_relations set to_work_id = ${t} where to_work_id = ${s}`,
  ];
}
