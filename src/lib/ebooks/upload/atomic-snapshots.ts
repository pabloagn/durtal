import { uuidArraySql } from "@/lib/db/sql-arrays";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { resultRows } from "@/lib/harmonization/store";
import { z } from "zod/v4";

const TIMESTAMPS = {
  ebooks: ["created_at", "updated_at", "matched_at"],
  ebook_files: ["created_at", "updated_at", "source_mtime", "verified_at"],
  ebook_positions: ["updated_at", "client_updated_at"],
  ebook_annotations: ["created_at", "updated_at", "client_updated_at", "deleted_at"],
  ebook_annotation_retired_ids: ["retired_at"],
  ebook_annotation_cursors: ["server_time"],
  reading_notes: ["created_at", "updated_at"],
  ebook_ingest_runs: ["started_at", "finished_at", "updated_at"],
  ebook_ingest_items: ["source_mtime", "created_at", "updated_at"],
  ebook_upload_operations: ["lease_expires_at", "retention_expires_at", "effect_committed_at", "cleanup_verified_at",
    "reservation_released_at", "created_at", "updated_at"],
  ebook_upload_capacity: ["owner_lease_expires_at", "worker_lease_expires_at", "measured_at", "created_at", "updated_at"],
} as const;
export type UploadSnapshotTable = keyof typeof TIMESTAMPS;
export const UPLOAD_TARGET_TABLES = Object.freeze([
  "ebooks", "ebook_files", "ebook_positions", "ebook_annotations", "ebook_annotation_retired_ids",
  "ebook_annotation_cursors", "reading_notes", "ebook_ingest_runs", "ebook_ingest_items",
] as const);
export const UPLOAD_READER_TABLES = Object.freeze([
  "ebook_positions", "ebook_annotations", "ebook_annotation_retired_ids", "ebook_annotation_cursors", "reading_notes",
] as const);
/** Full row, including future columns, with known timestamp fields formatted
 * inside PostgreSQL as UTC six-digit strings. No Date or session timezone is
 * part of planning/guard serialization. Invalid infinities remain distinct. */
export function uploadRowSnapshotSql(table: UploadSnapshotTable, alias = "r"): SQL {
  const fields = TIMESTAMPS[table].flatMap((name) => {
    const column = sql`${sql.identifier(alias)}.${sql.identifier(name)}`;
    return [sql`${name}::text`, sql`case when ${column} is null then null
      when isfinite(${column}) then to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      else '!nonfinite!' end`];
  });
  return sql`to_jsonb(${sql.identifier(alias)}) || jsonb_build_object(${sql.join(fields, sql`, `)})`;
}
function columnSql(alias: string, column: string) {
  return sql`${sql.identifier(alias)}.${sql.identifier(column)}`;
}
export function uploadSnapshotScopeSql(table: typeof UPLOAD_TARGET_TABLES[number],
  scope: { ebookIds: readonly string[]; runId: string }, alias = "r"): SQL {
  const ids = [...scope.ebookIds].map((id) => z.uuid().parse(id));
  if (table === "ebooks") return sql`${columnSql(alias, "id")}=any(${uuidArraySql(ids)})`;
  if (table === "ebook_ingest_runs") return sql`${columnSql(alias, "id")}=${z.uuid().parse(scope.runId)}::uuid`;
  if (table === "ebook_ingest_items") return sql`${columnSql(alias, "run_id")}=${z.uuid().parse(scope.runId)}::uuid`;
  if (table === "reading_notes") return sql`${columnSql(alias, "ebook_annotation_id")} in (
    select id from ebook_annotations where ebook_id=any(${uuidArraySql(ids)})
    union select id from ebook_annotation_retired_ids where ebook_id=any(${uuidArraySql(ids)}))`;
  return sql`${columnSql(alias, "ebook_id")}=any(${uuidArraySql(ids)})`;
}
export function uploadTableSnapshotSql(table: typeof UPLOAD_TARGET_TABLES[number], scope: { ebookIds: readonly string[]; runId: string }): SQL {
  const row = uploadRowSnapshotSql(table);
  return sql`(select coalesce(jsonb_agg(${row} order by (${row})::text),'[]'::jsonb)
    from ${sql.identifier(table)} r where ${uploadSnapshotScopeSql(table, scope)})`;
}
export async function readUploadTargetSnapshotOn(conn: Db, scope: { ebookIds: readonly string[]; runId: string }) {
  const fields = UPLOAD_TARGET_TABLES.flatMap((table) => [sql`${table}::text`, uploadTableSnapshotSql(table, scope)]);
  const rows = resultRows<{ snapshot: { [K in typeof UPLOAD_TARGET_TABLES[number]]: Record<string, unknown>[] } }>(
    await conn.execute(sql`select jsonb_build_object(${sql.join(fields, sql`, `)}) as snapshot`));
  if (rows.length !== 1) throw new Error("Actual upload target snapshot missing");
  return rows[0].snapshot;
}

export function requireCanonicalUploadRow(table: UploadSnapshotTable, row: Record<string, unknown>): void {
  for (const column of TIMESTAMPS[table]) {
    const value = row[column];
    if (value !== null && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)))
      throw new Error("Upload snapshot requires actual finite UTC6 timestamp text: " + table + "." + column);
  }
}
export async function readUploadControlSnapshotsOn(conn: Db, commandId: string, jobId: string) {
  const rows = resultRows<{ command: Record<string, unknown>; job: Record<string, unknown>; capacity: Record<string, unknown> }>(
    await conn.execute(sql`select ${uploadRowSnapshotSql("ebook_upload_operations", "o")} as command,
      ${uploadRowSnapshotSql("ebook_upload_operations", "j")} as job,
      ${uploadRowSnapshotSql("ebook_upload_capacity", "c")} as capacity
      from ebook_upload_operations o join ebook_upload_operations j on j.id=${z.uuid().parse(jobId)}::uuid
      join ebook_upload_capacity c on c.volume_id=o.volume_id
      where o.id=${z.uuid().parse(commandId)}::uuid and o.parent_operation_id=j.id
        and o.volume_id=j.volume_id and o.binding_sha256=j.binding_sha256 and o.target_fingerprint=j.target_fingerprint`));
  if (rows.length !== 1) throw new Error("Actual upload control snapshots missing");
  return rows[0];
}
