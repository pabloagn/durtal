import { getTableColumns, sql } from "drizzle-orm";
import { editions } from "@/lib/db/schema";
import { db } from "@/lib/db";
import type { Db } from "./work-store";
import { STALE_RECORD } from "./work-store";
import { assertSql, lockSql, resultRows } from "@/lib/harmonization/store";

const LINK_TABLES = ["edition_contributors", "edition_genres", "edition_tags", "edition_publishers"];
const MOVE_TABLES = ["reading_sessions", "readings", "reading_queue", "reading_notes"];
/** Capture SQL JSON as text: timestamp microseconds never pass through JS Date.
 * Normalize the row's concurrency timestamp to UTC across pooled connections. */
function stateSql(id: string, includeMoveRows = false) {
  const related = [...LINK_TABLES, ...(includeMoveRows ? MOVE_TABLES : [])].flatMap((table) => [
    sql`${table}::text`,
    sql`coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text)
      from ${sql.identifier(table)} r where r.edition_id=${id}::uuid), '[]'::jsonb)`,
  ]);
  return sql`(select jsonb_build_object('edition', to_jsonb(e) || jsonb_build_object(
    'updated_at', to_char(e.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    'created_at', to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')),
    'related', jsonb_build_object(${sql.join(related, sql`, `)}))
    from editions e where e.id=${id}::uuid)`;
}
export interface EditionWriteSnapshot { readonly editionId: string; readonly state: string; readonly includeMoveRows?: boolean }
export async function readEditionWriteSnapshot(id: string, conn: Db = db, includeMoveRows = false): Promise<EditionWriteSnapshot> {
  const row = resultRows<{ state: string | null }>(
    await conn.execute(sql`select ${stateSql(id, includeMoveRows)}::text as state`),
  )[0];
  if (!row?.state) throw new Error("Edition not found");
  return Object.freeze({ editionId: id, state: row.state, includeMoveRows });
}
/** Lock is its own statement; the following assertion reads a fresh snapshot
 * after lock acquisition in READ COMMITTED, on both Neon batch and local tx. */
export function editionWriteGuardQueries(d: Db, expected: EditionWriteSnapshot) {
  return [
    d.execute(lockSql(["authors", "editions", ...LINK_TABLES, ...(expected.includeMoveRows ? MOVE_TABLES : [])])),
    d.execute(assertSql(
      sql`${stateSql(expected.editionId, expected.includeMoveRows)} is not null and ${stateSql(expected.editionId, expected.includeMoveRows)} = ${expected.state}::jsonb`,
      STALE_RECORD,
    )),
  ];
}

/** Assert the actual UPDATE count inside its statement, including a trigger
 * that suppresses mutation. Both drivers keep this and the guard in one tx. */
export function editionUpdateQuery(d: Db, id: string, updates: Record<string, unknown>) {
  const columns = getTableColumns(editions);
  const assignments = Object.entries(updates).filter(([, value]) => value !== undefined).map(([key, value]) => {
    const column = columns[key as keyof typeof columns];
    if (!column || key === "id") throw new Error("Unsupported edition update field");
    return sql`${sql.identifier(column.name)} = ${sql.param(value, column)}`;
  });
  if (!assignments.length) throw new Error("Empty edition mutation");
  return d.execute(sql`with changed as (
    update editions set ${sql.join(assignments, sql`, `)} where id=${id}::uuid returning id
  ) ${assertSql(sql`(select count(*) from changed) = 1`, STALE_RECORD)}`);
}
