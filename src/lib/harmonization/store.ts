import { is, sql, type SQL } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { ENTITIES } from "./registry";
import type { Dataset, Row } from "./types";

export const TABLES = new Map(
  (Object.values(schema) as unknown[])
    .filter((t): t is PgTable => is(t, PgTable))
    .map((t) => [getTableConfig(t).name, t]),
);
export function config(name: string) {
  const table = TABLES.get(name);
  if (!table) throw new Error("Unsupported catalogue table");
  return getTableConfig(table);
}
export const ident = (name: string) => sql.identifier(name);
export function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows: T[] }).rows;
}
const SCAN_TABLES = [
  ...new Set([
    ...ENTITIES.map((e) => e.table),
    "media",
    "work_authors",
    "edition_publishers",
    "ignored_publisher_names",
    "collection_editions",
    "taxonomy_families",
  ]),
];
export async function loadDataset(): Promise<Dataset> {
  const pairs = SCAN_TABLES.flatMap((name) => {
    config(name);
    return [
      sql`${name}::text`,
      sql`coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from ${ident(name)} r), '[]'::jsonb)`,
    ];
  });
  const rows = resultRows<{ data: Dataset }>(
    await db.execute(
      sql`select jsonb_build_object(${sql.join(pairs, sql`, `)}) as data`,
    ),
  );
  return rows[0].data;
}
export interface Reference {
  table: string;
  columns: string[];
  polymorphic?: string;
}
export function referencesTo(tableName: string): Reference[] {
  const refs: Reference[] = [];
  for (const [name] of TABLES) {
    const cols = config(name).foreignKeys.flatMap((fk) => {
      const ref = fk.reference();
      if (getTableConfig(ref.foreignTable).name !== tableName) return [];
      if (ref.columns.length !== 1 || ref.foreignColumns[0].name !== "id")
        throw new Error("This relationship needs a dedicated merge strategy");
      return [ref.columns[0].name];
    });
    if (cols.length) refs.push({ table: name, columns: cols });
  }
  const type = (
    { works: "work", authors: "author", collections: "collection" } as Record<
      string,
      string
    >
  )[tableName];
  if (type)
    for (const name of ["activity_events", "comments", "gallery_layouts"])
      refs.push({ table: name, columns: ["entity_id"], polymorphic: type });
  return refs.sort((a, b) => a.table.localeCompare(b.table));
}
export function referenceWhere(ref: Reference, ids: string[]): SQL {
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const columns = sql.join(
    ref.columns.map((c) => sql`${ident(c)} in (${list})`),
    sql` or `,
  );
  return sql`(${columns}) ${ref.polymorphic ? sql`and entity_type = ${ref.polymorphic}` : sql``}`;
}
export interface Snapshot {
  records: Row[];
  references: Record<string, Row[]>;
}
export function snapshotQuery(table: string, ids: string[]): SQL {
  const refs = referencesTo(table);
  const pairs = refs.flatMap((ref) => [
    sql`${ref.table}::text`,
    sql`coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from ${ident(ref.table)} r where ${referenceWhere(ref, ids)}), '[]'::jsonb)`,
  ]);
  return sql`select jsonb_build_object(
    'records', coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from ${ident(table)} r where id in (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})), '[]'::jsonb),
    'references', jsonb_build_object(${sql.join(pairs, sql`, `)})
  ) as data`;
}
export async function loadSnapshot(table: string, ids: string[]) {
  const query = snapshotQuery(table, ids);
  return resultRows<{ data: Snapshot; fingerprint: string }>(
    await db.execute(
      sql`select data, md5(data::text) as fingerprint from (${query}) s`,
    ),
  )[0];
}
export function assertSql(condition: SQL, message: string) {
  return sql`select harmonization_assert(${condition}, ${message})`;
}
/** Brief table locks also protect against writes from older editing screens. */
export function lockSql(tables: string[]) {
  return sql`lock table ${sql.join([...new Set(tables)].sort().map(ident), sql`, `)} in share row exclusive mode`;
}
export async function persistenceAvailable() {
  const rows = resultRows<{ ready: boolean }>(
    await db.execute(
      sql`select to_regclass('public.harmonization_operations') is not null and to_regprocedure('harmonization_assert(boolean,text)') is not null as ready`,
    ),
  );
  return rows[0].ready;
}
