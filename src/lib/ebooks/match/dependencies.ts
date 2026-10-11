import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { resultRows } from "@/lib/harmonization/store";
import type { StoredRow } from "./load";

export interface ForeignReference {
  parentTable: string;
  childTable: string;
  parentColumns: string[];
  childColumns: string[];
}
export interface DependencySnapshot {
  references: readonly ForeignReference[];
  rows: Readonly<Record<string, readonly StoredRow[]>>;
}
/** Discover every real FK, including new downstream tables. Undo never keeps
 * a handwritten list that silently loses readings or later references. */
function foreignReferencesQuery(): SQL {
  return sql`
    select p.relname as "parentTable", r.relname as "childTable",
      array(select a.attname from unnest(c.confkey) with ordinality k(num,n) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.num order by k.n) as "parentColumns",
      array(select a.attname from unnest(c.conkey) with ordinality k(num,n) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num order by k.n) as "childColumns"
    from pg_constraint c join pg_class p on p.oid=c.confrelid join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace
    where c.contype='f' and n.nspname='public' and p.relname in ('instances','editions','works','authors','series','enrichment_jobs')
    order by p.relname,r.relname,c.conname`;
}
export function dependencyReferenceGuardCondition(references: readonly ForeignReference[]): SQL {
  return sql`(select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
    from (${foreignReferencesQuery()}) r)=${JSON.stringify(references)}::jsonb`;
}
export async function loadMatchDependencies(
  conn: Db,
): Promise<DependencySnapshot> {
  // SQL results may carry non-enumerable driver metadata. Only row values
  // belong in the internal DTO; untrusted writer inputs remain strict.
  const references = Array.from(resultRows<ForeignReference>(
    await conn.execute(foreignReferencesQuery()),
  ));
  const rows: Record<string, StoredRow[]> = {};
  for (const table of [
    ...new Set([
      ...references.map((ref) => ref.childTable),
      "activity_events",
      "instance_status_history",
      "work_status_history",
    ]),
  ].sort()) {
    rows[table] = resultRows<{ row: StoredRow }>(
      await conn.execute(
        sql`select to_jsonb(r) row from ${sql.identifier(table)} r order by to_jsonb(r)::text`,
      ),
    ).map(({ row }) => row);
  }
  return { references, rows };
}
export function referencingRows(
  dependencies: DependencySnapshot,
  parentTable: string,
  parent: StoredRow,
): { table: string; row: StoredRow }[] {
  return dependencies.references
    .filter((ref) => ref.parentTable === parentTable)
    .flatMap((ref) =>
      (dependencies.rows[ref.childTable] ?? [])
        .filter((row) =>
          ref.parentColumns.every(
            (column, i) =>
              parent[column] != null &&
              row[ref.childColumns[i]] === parent[column],
          ),
        )
        .map((row) => ({ table: ref.childTable, row })),
    );
}
export function dependencyGuardCondition(
  table: string,
  rows: readonly StoredRow[],
): SQL {
  return sql`(select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),'[]'::jsonb) from ${sql.identifier(table)} r)=${JSON.stringify(rows)}::jsonb`;
}
