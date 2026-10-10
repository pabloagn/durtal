import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { assertSql, lockSql } from "@/lib/harmonization/store";
import { MATCH_TABLES, type LoadedMatchCatalogue, type StoredRow } from "./load";

export type AdditionalSnapshotRows = Readonly<Partial<Record<"sub_locations", readonly StoredRow[]>>>;

/** Serializable snapshot and operation identity are checked under the same
 * transaction as every mutation. Table locks also cover new competitor rows
 * and older callers that do not participate in a matcher advisory lock. */
export function snapshotGuardQueries(
  d: Db,
  loaded: Pick<LoadedMatchCatalogue, "rows">,
  extraTables: readonly string[] = [],
  additionalSnapshotRows: AdditionalSnapshotRows = {},
): unknown[] {
  const names = Object.keys(additionalSnapshotRows);
  if (names.some((name) => name !== "sub_locations") ||
      names.some((name) => MATCH_TABLES.includes(name as typeof MATCH_TABLES[number])) ||
      names.some((name) => !Array.isArray(additionalSnapshotRows[name as "sub_locations"])))
    throw new Error("Unsupported or duplicate additional matching snapshot table");
  const tables = [...MATCH_TABLES, ...names];
  return [
    d.execute(lockSql([...new Set([...tables, ...extraTables])].sort())),
    ...tables.map((table) =>
      d.execute(
        assertSql(
          sql`(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text), '[]'::jsonb) from ${sql.identifier(table)} r) = ${JSON.stringify(table === "sub_locations" ? additionalSnapshotRows.sub_locations : loaded.rows[table as keyof typeof loaded.rows])}::jsonb`,
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
