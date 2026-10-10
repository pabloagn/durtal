import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { assertSql, lockSql } from "@/lib/harmonization/store";
import { MATCH_TABLES, type LoadedMatchCatalogue } from "./load";

/** Serializable snapshot and operation identity are checked under the same
 * transaction as every mutation. Table locks also cover new competitor rows
 * and older callers that do not participate in a matcher advisory lock. */
export function snapshotGuardQueries(
  d: Db,
  loaded: Pick<LoadedMatchCatalogue, "rows">,
  extraTables: readonly string[] = [],
): unknown[] {
  return [
    d.execute(lockSql([...new Set([...MATCH_TABLES, ...extraTables])].sort())),
    ...MATCH_TABLES.map((table) =>
      d.execute(
        assertSql(
          sql`(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text), '[]'::jsonb) from ${sql.identifier(table)} r) = ${JSON.stringify(loaded.rows[table])}::jsonb`,
          `Matching snapshot changed in ${table}; make a new plan`,
        ),
      ),
    ),
  ];
}
export function rowSnapshotCondition(
  table: string,
  id: string,
  value: unknown,
): SQL {
  return sql`exists(select 1 from ${sql.identifier(table)} r where r.id=${id}::uuid and to_jsonb(r)=${JSON.stringify(value)}::jsonb)`;
}
