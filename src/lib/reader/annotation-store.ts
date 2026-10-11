import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomicOn } from "@/lib/db/atomic";
import { resultRows } from "@/lib/harmonization/store";
import {
  annotationBodySchema,
  annotationPullSchema,
  annotationRecordSchema,
  type AnnotationUpsert,
  type AnnotationDeleteRequest,
} from "@/lib/validations/annotations";
import { canonicalAnnotationTime } from "./sync/annotation-time";

type Db = typeof db;
export class AnnotationInputError extends Error {}
export type AnnotationBody = ReturnType<
  ReturnType<typeof annotationBodySchema>["parse"]
>;
const time = (column: SQL) =>
  sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
/** Whitelisted wire fields. Internal quote epochs never become browser puts. */
export const annotationJson = (alias = "a") => {
  const a = (column: string) => sql.raw(`${alias}.${column}`);
  return sql`jsonb_build_object('id', ${a("id")}, 'ebookId', ${a("ebook_id")}, 'fileId', ${a("file_id")},
    'kind', ${a("kind")}, 'style', ${a("style")}, 'color', ${a("color")}, 'locator', ${a("locator")},
    'progression', ${a("progression")}, 'chapter', ${a("chapter")}, 'text', ${a("text")}, 'note', ${a("note")},
    'anchorState', ${a("anchor_state")}, 'deviceId', ${a("device_id")},
    'clientUpdatedAt', ${time(a("client_updated_at"))}, 'createdAt', ${time(a("created_at"))},
    'updatedAt', ${time(a("updated_at"))}, 'deletedAt', ${time(a("deleted_at"))})`;
};
const json = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;
const ids = (values: readonly string[]) => json(values);
const purge = (ebookId: string) => sql`delete from ebook_annotations a
  where a.ebook_id = ${ebookId}::uuid and a.deleted_at < clock_timestamp() - interval '90 days'
  and exists (select 1 from ebook_annotation_retired_ids r where r.id = a.id and r.ebook_id = a.ebook_id)`;
/** Lock every affected/purge identity in one global UUID order before any item
 * query. The per-book lock serializes clock/row access; subsequent READ COMMITTED
 * statements obtain fresh snapshots after an advisory identity wait.
 */
const lockIds = (
  ebookId: string,
  values: readonly string[],
) => sql`select public.durtal_annotation_lock_id(id) from (
  select value::uuid as id from jsonb_array_elements_text(${ids(values)})
  union select id from ebook_annotations where ebook_id = ${ebookId}::uuid and deleted_at < clock_timestamp() - interval '90 days'
) affected order by id`;
export async function annotationBookExists(ebookId: string, on: Db = db) {
  const [row] = resultRows<{ exists: boolean }>(
    await on.execute(
      sql`select exists(select 1 from ebooks where id = ${ebookId}::uuid) as exists`,
    ),
  );
  return !!row?.exists;
}
export async function annotationFilesBelong(
  ebookId: string,
  body: AnnotationBody,
  on: Db = db,
) {
  const files = [
    ...new Set(
      body.upserts.flatMap((item) => (item.op === "note" ? [] : [item.fileId])),
    ),
  ];
  if (!files.length) return true;
  const rows = resultRows<{ id: string; sha256: string }>(
    await on.execute(
      sql`select id, sha256 from ebook_files where ebook_id = ${ebookId}::uuid and id in (select value::uuid from jsonb_array_elements_text(${ids(files)}))`,
    ),
  );
  return body.upserts.every(
    (item) =>
      item.op === "note" ||
      rows.some(
        (file) =>
          file.id === item.fileId && file.sha256 === item.locator.fileHash,
      ),
  );
}
export async function readAnnotations(
  ebookId: string,
  since: string | null,
  on: Db = db,
) {
  const cursor = since === null ? null : canonicalAnnotationTime(since);
  const results = await atomicOn(on, (d) => [
    d.execute(sql`select public.durtal_annotation_lock_book(${ebookId}::uuid)`),
    d.execute(lockIds(ebookId, [])),
    d.execute(purge(ebookId)),
    d.execute(sql`select public.durtal_annotation_tick(${ebookId}::uuid)`),
    d.execute(sql`select ${time(sql`c.server_time`)} as "serverTime",
      (${cursor}::timestamptz is null or ${cursor}::timestamptz <= c.server_time - interval '90 days') as reset,
      (${cursor}::timestamptz > c.server_time) as "invalidSince",
      coalesce((select jsonb_agg(${annotationJson()} order by a.updated_at, a.id) from ebook_annotations a
        where a.ebook_id = c.ebook_id and a.updated_at <= c.server_time and
        (case when ${cursor}::timestamptz is null or ${cursor}::timestamptz <= c.server_time - interval '90 days'
          then a.deleted_at is null else a.updated_at >= ${cursor}::timestamptz end)), '[]'::jsonb) as annotations
      from ebook_annotation_cursors c where c.ebook_id = ${ebookId}::uuid`),
  ]);
  const [row] = resultRows<{
    serverTime: string;
    reset: boolean;
    annotations: unknown[];
    invalidSince: boolean | null;
  }>(results.at(-1));
  if (!row) throw new Error("Annotation cursor missing after locked pull");
  if (row.invalidSince)
    throw new AnnotationInputError("Annotation cursor is ahead of the server");
  return annotationPullSchema.parse({
    annotations: row.annotations,
    reset: row.reset,
    serverTime: row.serverTime,
  });
}
const facts = (
  ebookId: string,
  id: string,
) => sql`current as materialized (select * from ebook_annotations where id = ${id}::uuid for update),
  retired as materialized (select * from ebook_annotation_retired_ids where id = ${id}::uuid),
  base as (select case
    when exists(select 1 from current where ebook_id <> ${ebookId}::uuid) or exists(select 1 from retired where ebook_id <> ${ebookId}::uuid) then 'identity'
    when exists(select 1 from retired) or exists(select 1 from current where deleted_at is not null) then 'deleted'
    else null end as reason)`;
function upsertQuery(
  ebookId: string,
  deviceId: string,
  item: AnnotationUpsert,
): SQL {
  if (item.op === "put")
    return sql`with ${facts(ebookId, item.id)}, decision as (select coalesce(base.reason,
    (select case when style = 'quote' then 'quote-privilege' when kind <> ${item.kind} then 'immutable-kind'
      when text is distinct from ${item.text} then 'immutable-text'
      when client_updated_at = ${item.clientUpdatedAt}::timestamptz then 'equal'
      when client_updated_at > ${item.clientUpdatedAt}::timestamptz then 'older' else null end from current)) as reason from base),
    written as (insert into ebook_annotations (id, ebook_id, file_id, kind, style, color, locator, progression, text, note, chapter, device_id, client_updated_at)
      select ${item.id}::uuid, ${ebookId}::uuid, ${item.fileId}::uuid, ${item.kind}, ${item.style}, ${item.color}, ${json(item.locator)},
        ${item.locator.totalProgression}, ${item.text}, ${item.note}, ${item.chapter}, ${deviceId}, ${item.clientUpdatedAt}::timestamptz
      where (select reason from decision) is null
      on conflict (id) do update set style = excluded.style, color = excluded.color, note = excluded.note,
        device_id = excluded.device_id, client_updated_at = excluded.client_updated_at
      where ebook_annotations.ebook_id = excluded.ebook_id and ebook_annotations.deleted_at is null
        and ebook_annotations.client_updated_at < excluded.client_updated_at
        and ebook_annotations.kind = excluded.kind and ebook_annotations.text is not distinct from excluded.text and ebook_annotations.style <> 'quote'
      returning id)
    select ${item.id} as id, case when exists(select 1 from written) then 'applied' else 'ignored' end as status,
      (select reason from decision) as reason`;
  if (item.op === "note")
    return sql`with ${facts(ebookId, item.id)}, decision as (select coalesce(base.reason,
    case when not exists(select 1 from current) then 'missing' else (select case when kind = 'bookmark' then 'bookmark-note'
      when client_updated_at = ${item.clientUpdatedAt}::timestamptz then 'equal' when client_updated_at > ${item.clientUpdatedAt}::timestamptz then 'older' else null end from current) end) as reason from base),
    written as (update ebook_annotations set note = ${item.note}, device_id = ${deviceId}, client_updated_at = ${item.clientUpdatedAt}::timestamptz
      where id = ${item.id}::uuid and ebook_id = ${ebookId}::uuid and (select reason from decision) is null returning id)
    select ${item.id} as id, case when exists(select 1 from written) then 'applied' else 'ignored' end as status, (select reason from decision) as reason`;
  return sql`with ${facts(ebookId, item.id)}, decision as (select coalesce(base.reason,
    case when not exists(select 1 from current) then 'missing' else (select case
      when file_id <> ${item.expectedFileId}::uuid or client_updated_at <> ${item.expectedClientUpdatedAt}::timestamptz then 'anchor-changed'
      when file_id = ${item.fileId}::uuid and anchor_state = ${item.anchorState} and locator = ${json(item.locator)} then 'unchanged' else null end from current) end) as reason from base),
    written as (update ebook_annotations set file_id = ${item.fileId}::uuid, locator = ${json(item.locator)}, progression = ${item.locator.totalProgression}, anchor_state = ${item.anchorState}
      where id = ${item.id}::uuid and ebook_id = ${ebookId}::uuid and (select reason from decision) is null returning id)
    select ${item.id} as id, case when exists(select 1 from written) then 'applied' else 'ignored' end as status, (select reason from decision) as reason`;
}
function deleteQuery(ebookId: string, item: AnnotationDeleteRequest): SQL {
  if (item.quoteEffect && item.quoteEffect.action !== "none")
    return sql`select ${item.id} as id,
    public.durtal_annotation_finalize_delete(${ebookId}::uuid, ${item.id}::uuid, ${item.clientUpdatedAt}::timestamptz,
      ${item.operationId}, ${item.revision}::bigint, ${json(item.quoteEffect)}) as composed`;
  return sql`with ${facts(ebookId, item.id)}, decision as (select coalesce(base.reason,
    (select case when style = 'quote' then 'quote-choice' else null end from current)) as reason from base),
    written as (update ebook_annotations set deleted_at = clock_timestamp(), client_updated_at = greatest(client_updated_at, ${item.clientUpdatedAt}::timestamptz)
      where id = ${item.id}::uuid and ebook_id = ${ebookId}::uuid and (select reason from decision) is null returning id),
    retired_absent as (insert into ebook_annotation_retired_ids (id, ebook_id, retired_at)
      select ${item.id}::uuid, ${ebookId}::uuid, public.durtal_annotation_tick(${ebookId}::uuid)
      where (select reason from decision) is null and not exists(select 1 from current) on conflict (id) do nothing returning id)
    select ${item.id} as id, case when exists(select 1 from written) or exists(select 1 from retired_absent) then 'applied' else 'ignored' end as status,
      (select reason from decision) as reason`;
}
/** No JavaScript pre-read decides a write. Predicates execute under the same
 * atomic locks as mutations, purge, logical time and authoritative response.
 * Quote effects call the separately reviewed 0087-dependent composition source.
 */
export async function saveAnnotations(
  ebookId: string,
  deviceId: string,
  body: AnnotationBody,
  on: Db = db,
) {
  const items = [...body.upserts, ...body.deletes];
  const results = await atomicOn(on, (d) => [
    d.execute(sql`select public.durtal_annotation_lock_book(${ebookId}::uuid)`),
    d.execute(
      lockIds(
        ebookId,
        items.map((item) => item.id),
      ),
    ),
    ...body.upserts.map((item) =>
      d.execute(upsertQuery(ebookId, deviceId, item)),
    ),
    ...body.deletes.map((item) => d.execute(deleteQuery(ebookId, item))),
    d.execute(purge(ebookId)),
    d.execute(sql`select public.durtal_annotation_tick(${ebookId}::uuid)`),
    d.execute(sql`select ${time(sql`c.server_time`)} as "serverTime",
      coalesce((select jsonb_agg(${annotationJson()} order by a.updated_at, a.id) from ebook_annotations a
        where a.ebook_id = c.ebook_id and a.id in (select value::uuid from jsonb_array_elements_text(${ids(items.map((item) => item.id))}))), '[]'::jsonb) as annotations
      from ebook_annotation_cursors c where c.ebook_id = ${ebookId}::uuid`),
  ]);
  const applied: string[] = [],
    ignored: { id: string; reason: string }[] = [];
  for (let i = 0; i < items.length; i++) {
    const [outcome] = resultRows<{
      id: string;
      status?: string;
      reason?: string | null;
      composed?: { status: string; reason?: string };
    }>(results[i + 2]);
    if (!outcome || outcome.id !== items[i].id)
      throw new Error("Invalid annotation mutation result");
    if (
      outcome.status === "applied" ||
      outcome.composed?.status === "committed"
    )
      applied.push(outcome.id);
    else
      ignored.push({
        id: outcome.id,
        reason:
          outcome.reason ??
          outcome.composed?.reason ??
          (outcome.composed?.status === "already-retired"
            ? "deleted"
            : "unchanged"),
      });
  }
  const [receipt] = resultRows<{ serverTime: string; annotations: unknown[] }>(
    results.at(-1),
  );
  if (!receipt) throw new Error("Missing annotation receipt");
  return {
    applied,
    ignored,
    serverTime: canonicalAnnotationTime(receipt.serverTime),
    annotations: receipt.annotations.map((item) =>
      annotationRecordSchema.parse(item),
    ),
    operations: body.deletes.flatMap((item) =>
      item.operationId !== undefined && item.revision !== undefined
        ? [{ operationId: item.operationId, revision: item.revision }]
        : [],
    ),
  };
}
