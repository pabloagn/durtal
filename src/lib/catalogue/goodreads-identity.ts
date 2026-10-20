import { sql, type SQL } from "drizzle-orm";
import { ExpectedActionError } from "@/lib/actions/expected-error";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import { catalogueIdentifiers } from "@/lib/db/schema";
import { assertSql, lockSql, resultRows } from "@/lib/harmonization/store";
import { goodreadsBookId, goodreadsBookKey } from "./goodreads-id";
import type { StoredRow } from "@/lib/reading/import/store";

export interface GoodreadsIdentitySnapshot {
  id: string;
  provider: "goodreads";
  entityKind: "book" | "edition";
  workId: string | null;
  editionId: string | null;
  externalId: string;
  effectiveWorkId: string;
}

const json = (value: unknown) => JSON.stringify(value);
/** SQL counterpart of goodreadsBookKey; only book-show URLs or decimal text qualify. */
export function goodreadsKeySql(value: SQL): SQL {
  return sql`regexp_replace(coalesce(substring(btrim(${value}) from '^([0-9]+)$'),
    substring(${value} from '/book/show/([0-9]+)')), '^0+(?=[0-9])', '')`;
}

/** All existing effective book owners, including the legacy fields. No metadata is repaired. */
export function goodreadsOwnersSql(): SQL {
  return sql`
    select ${goodreadsKeySql(sql`ci.external_id`)} as key, coalesce(ci.work_id, e.work_id) as work_id,
      ci.id as identifier_id
    from catalogue_identifiers ci left join editions e on e.id = ci.edition_id
    where ci.provider = 'goodreads' and ci.entity_kind in ('book','edition')
    union all
    select ${goodreadsKeySql(sql`e.goodreads_id`)}, e.work_id, null::uuid from editions e where e.goodreads_id is not null
    union all
    select ${goodreadsKeySql(sql`w.goodreads_url`)}, w.id, null::uuid from works w where w.goodreads_url is not null`;
}

/** Import and registry claims share these locks; unrelated legacy writers do not. */
function claimLocks(ids: string[], tables: string[] = []) {
  const keys = [...new Set(ids.map(goodreadsBookKey).filter((key): key is string => key !== null))].sort();
  return [
    // A separate first statement is essential: the checks need a post-lock READ COMMITTED snapshot.
    sql`select pg_advisory_xact_lock(hashtextextended('goodreads-book:' || key, 0))
      from (select value as key from jsonb_array_elements_text(${json(keys)}::jsonb) order by value) ordered_keys`,
    lockSql(["catalogue_identifiers", "editions", "works", ...tables]),
  ];
}

function choicesSql(claims: SQL) {
  return sql`with claims as (${claims}), choices as (
    select key, (array_agg(gid order by row_no))[1] as gid, min(work_id::text)::uuid as work_id,
      case when count(edition_id) = count(*) and count(distinct edition_id) = 1
        then min(edition_id::text)::uuid else null end as edition_id,
      min(row_no) as journal_row
    from claims group by key
  )`;
}

function claimChecks(claims: SQL, expected: number) {
  const prefix = choicesSql(claims);
  return [
    assertSql(sql`(select count(*) from (${claims}) accepted) = ${expected}`,
      "The Goodreads import rows or selected book changed; reload before committing"),
    sql`${prefix} select harmonization_assert(
      not exists (select 1 from claims group by key having count(distinct work_id) > 1),
      coalesce((select 'Goodreads Book Id ' || min(gid) || ' is assigned to different books in the accepted rows'
        from claims group by key having count(distinct work_id) > 1 limit 1), 'Conflicting Goodreads rows'))`,
    sql`${prefix}, owners as (${goodreadsOwnersSql()})
      select harmonization_assert(not exists (
        select 1 from choices c join owners o on o.key = c.key where o.work_id is distinct from c.work_id),
        coalesce((select 'Goodreads Book Id ' || c.gid || ' conflicts with another book (accepted row ' || c.journal_row || ')'
          from choices c join owners o on o.key = c.key where o.work_id is distinct from c.work_id limit 1),
          'Conflicting Goodreads Book Id'))`,
  ];
}

function insertSql(claims: SQL, importId?: string) {
  const prefix = choicesSql(claims);
  const added = sql`insert into catalogue_identifiers (entity_kind, work_id, edition_id, provider, external_id)
    select case when c.edition_id is null then 'book' else 'edition' end,
      case when c.edition_id is null then c.work_id else null end, c.edition_id, 'goodreads', c.gid
    from choices c where not exists (select 1 from (${goodreadsOwnersSql()}) o
      where o.key = c.key and ${importId ? sql`true` : sql`o.identifier_id in (
        select ci.id from catalogue_identifiers ci where ci.entity_kind = case when c.edition_id is null then 'book' else 'edition' end
          and ci.work_id is not distinct from case when c.edition_id is null then c.work_id else null end
          and ci.edition_id is not distinct from c.edition_id)`})
    returning id, provider, entity_kind, work_id, edition_id, external_id`;
  if (!importId) return sql`${prefix} ${added}`;
  // Only INSERT RETURNING IDs belong to this import. Duplicate rows journal once; every row records reuse.
  return sql`${prefix}, added as (${added})
    update reading_import_rows r set written = coalesce(r.written, '{"readings":[],"bookRating":null,"identifiers":[]}'::jsonb)
      || jsonb_build_object('goodreadsClaim', jsonb_build_object('externalId', x.gid, 'key', x.key, 'workId', x.work_id),
        'identifiers', coalesce(r.written->'identifiers', '[]'::jsonb) ||
          case when a.id is not null and r.row_no = c.journal_row then jsonb_build_array(a.id) else '[]'::jsonb end,
        'identifierSnapshots', coalesce(r.written->'identifierSnapshots', '[]'::jsonb) ||
          case when a.id is not null and r.row_no = c.journal_row then jsonb_build_array(jsonb_build_object(
            'id', a.id, 'provider', a.provider, 'entityKind', a.entity_kind,
            'workId', a.work_id, 'editionId', a.edition_id, 'externalId', a.external_id, 'effectiveWorkId', c.work_id)) else '[]'::jsonb end)
    from claims x join choices c on c.key = x.key
    left join added a on ${goodreadsKeySql(sql`a.external_id`)} = c.key
    where r.import_id = ${importId}::uuid and r.row_no = x.row_no`;
}

/** Current accepted rows only. Claim+journal is atomic, independently of later reading/queue writes. */
export async function claimImportedGoodreadsIds(importId: string, rows: StoredRow[]): Promise<void> {
  const candidates = rows.filter((r) => r.decision === "import" && r.workId && !r.data.error &&
    goodreadsBookId(r.data.sourceBookId) && !["cannot", "not_imported"].includes(r.match.section) &&
    (r.data.kind === "readings" ? r.data.readings.length > 0 : !!r.data.queueKey));
  if (!candidates.length) return;
  const input = candidates.map((r) => ({ row_no: r.rowNo, work_id: r.workId, data: r.data, match: r.match }));
  const isbn = (value: SQL) => sql`regexp_replace(upper(coalesce(${value}, '')), '[^0-9X]', '', 'g')`;
  const claims = sql`select r.row_no, r.work_id, r.data->>'sourceBookId' as gid,
      ${goodreadsKeySql(sql`r.data->>'sourceBookId'`)} as key,
      case when r.match->>'reason' = 'Same ISBN' and not coalesce((r.match->>'chosen')::boolean, false)
        and e.work_id = r.work_id and (
          (nullif(${isbn(sql`r.data->>'isbn13'`)}, '') is not null and ${isbn(sql`r.data->>'isbn13'`)} = ${isbn(sql`e.isbn_13`)}) or
          (nullif(${isbn(sql`r.data->>'isbn10'`)}, '') is not null and ${isbn(sql`r.data->>'isbn10'`)} = ${isbn(sql`e.isbn_10`)}))
        then e.id else null end as edition_id
    from jsonb_to_recordset(${json(input)}::jsonb) x(row_no int, work_id uuid, data jsonb, match jsonb)
    join reading_import_rows r on r.import_id = ${importId}::uuid and r.row_no = x.row_no
      and r.work_id = x.work_id and r.data = x.data and r.match = x.match and r.decision = 'import'
    join imports i on i.id = r.import_id and i.source = 'goodreads' and i.status in ('pending','completed','undone')
    join works w on w.id = r.work_id and w.kind = 'book'
    left join editions e on e.id = (r.match->>'editionId')::uuid
    where r.data->>'error' is null and r.data->>'sourceBookId' ~ '^[0-9]+$'
      and (r.match->>'reason' is distinct from 'Same ISBN' or coalesce((r.match->>'chosen')::boolean, false) or (
        e.work_id = r.work_id and (
          (nullif(${isbn(sql`r.data->>'isbn13'`)}, '') is not null and ${isbn(sql`r.data->>'isbn13'`)} = ${isbn(sql`e.isbn_13`)}) or
          (nullif(${isbn(sql`r.data->>'isbn10'`)}, '') is not null and ${isbn(sql`r.data->>'isbn10'`)} = ${isbn(sql`e.isbn_10`)}))))
      and r.match->>'section' not in ('cannot','not_imported')
      and ((r.data->>'kind' = 'readings' and jsonb_array_length(r.data->'readings') > 0)
        or (r.data->>'kind' = 'to_read' and nullif(r.data->>'queueKey', '') is not null))`;
  await withReadableErrors(() => atomic((d) => [
    ...claimLocks(candidates.map((r) => r.data.sourceBookId!), ["imports", "reading_import_rows"]).map((q) => d.execute(q)),
    ...claimChecks(claims, candidates.length).map((q) => d.execute(q)),
    d.execute(insertSql(claims, importId)),
  ]));
}

/** Restricted to Goodreads book identity; person/author and all other registries retain their existing path. */
export async function registerGoodreadsIdentity(owner: { kind: "book" | "edition"; id: string }, externalId: string) {
  const gid = goodreadsBookId(externalId);
  if (!gid || gid !== externalId) throw new ExpectedActionError("A Goodreads Book Id must contain decimal digits");
  const claims = sql`select 0 as row_no, w.id as work_id, ${gid}::text as gid, ${goodreadsBookKey(gid)}::text as key,
      ${owner.kind === "edition" ? sql`e.id` : sql`null::uuid`} as edition_id
    from works w left join editions e on e.work_id = w.id
    where w.kind = 'book' and ${owner.kind === "edition" ? sql`e.id = ${owner.id}::uuid` : sql`w.id = ${owner.id}::uuid`}
    group by w.id${owner.kind === "edition" ? sql`, e.id` : sql``}`;
  const result = await withReadableErrors(() => atomic((d) => [
    ...claimLocks([gid]).map((q) => d.execute(q)), ...claimChecks(claims, 1).map((q) => d.execute(q)),
    d.execute(assertSql(sql`not exists (select 1 from catalogue_identifiers ci
      where ci.provider = 'goodreads' and ci.entity_kind = ${owner.kind}
        and ${goodreadsKeySql(sql`ci.external_id`)} = ${goodreadsBookKey(gid)}
        and ${owner.kind === "book" ? sql`ci.work_id` : sql`ci.edition_id`} is distinct from ${owner.id}::uuid)`,
      "This Goodreads identifier already belongs to another record in the requested namespace")),
    d.execute(insertSql(claims)),
    d.select().from(catalogueIdentifiers).where(sql`${catalogueIdentifiers.provider} = 'goodreads'
      and ${catalogueIdentifiers.entityKind} = ${owner.kind}
      and ${owner.kind === "book" ? catalogueIdentifiers.workId : catalogueIdentifiers.editionId} = ${owner.id}::uuid
      and ${goodreadsKeySql(sql`${catalogueIdentifiers.externalId}`)} = ${goodreadsBookKey(gid)}`)
      .orderBy(sql`${catalogueIdentifiers.externalId} = ${gid} desc`).limit(1),
  ]));
  return resultRows<typeof catalogueIdentifiers.$inferSelect>(result[result.length - 1])[0];
}

/** Snapshot-less historic journals are retained; only a new, unchanged and unshared identity may be removed. */
export function undoGoodreadsIdentityQueries(importId: string, snapshots: GoodreadsIdentitySnapshot[]) {
  const input = sql`jsonb_to_recordset(${json(snapshots)}::jsonb) x(id uuid, provider text, "entityKind" text,
    "workId" uuid, "editionId" uuid, "externalId" text, "effectiveWorkId" uuid)`;
  return [
    ...claimLocks(snapshots.map((s) => s.externalId), ["imports", "reading_import_rows", "source_records", "readings", "reading_queue"]),
    sql`delete from catalogue_identifiers ci using ${input}
      where ci.id = x.id and ci.provider = x.provider and ci.provider = 'goodreads'
        and ci.entity_kind = x."entityKind" and ci.work_id is not distinct from x."workId"
        and ci.edition_id is not distinct from x."editionId" and ci.external_id = x."externalId"
        and coalesce(ci.work_id, (select e.work_id from editions e where e.id = ci.edition_id)) = x."effectiveWorkId"
        and not exists (select 1 from source_records s where s.identifier_id = ci.id)
        and not exists (select 1 from reading_import_rows r join imports i on i.id = r.import_id
          where r.import_id <> ${importId}::uuid and i.source = 'goodreads' and r.decision = 'import'
            and r.work_id = coalesce(ci.work_id, (select e.work_id from editions e where e.id = ci.edition_id))
            and (r.written->'goodreadsClaim'->>'key' = ${goodreadsKeySql(sql`ci.external_id`)}
              or (r.written is not null and ${goodreadsKeySql(sql`r.data->>'sourceBookId'`)} = ${goodreadsKeySql(sql`ci.external_id`)})))
        and not exists (select 1 from readings r where r.import_id = ${importId}::uuid
          and r.work_id = coalesce(ci.work_id, (select e.work_id from editions e where e.id = ci.edition_id)))
        and not exists (select 1 from reading_queue q where q.import_id = ${importId}::uuid
          and q.work_id = coalesce(ci.work_id, (select e.work_id from editions e where e.id = ci.edition_id)))
      returning ci.id::text as id`,
  ];
}

/** Advisory preview only; the actual claim repeats all checks after locking. */
export function previewGoodreadsClaimsSql(importId: string): SQL {
  return sql`with candidates as (
    select r.work_id, ${goodreadsKeySql(sql`r.data->>'sourceBookId'`)} as key
    from reading_import_rows r join imports i on i.id = r.import_id and i.source = 'goodreads'
    join works w on w.id = r.work_id and w.kind = 'book'
    where r.import_id = ${importId}::uuid and r.decision = 'import' and r.data->>'error' is null
      and r.data->>'sourceBookId' ~ '^[0-9]+$' and r.match->>'section' not in ('cannot','not_imported')
      and ((r.data->>'kind' = 'readings' and jsonb_array_length(r.data->'readings') > 0)
        or (r.data->>'kind' = 'to_read' and nullif(r.data->>'queueKey', '') is not null))
  ), choices as (select key, min(work_id::text)::uuid as work_id from candidates group by key having count(distinct work_id) = 1),
  owners as (${goodreadsOwnersSql()})
  select count(*)::int as count from choices c where not exists (
    select 1 from owners o where o.key = c.key)`;
}
