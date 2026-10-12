import { sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import type { Db } from "@/lib/catalogue/work-store";
import { atomicOn } from "@/lib/db/atomic";
import { assertSql, lockSql, resultRows } from "@/lib/harmonization/store";
import { workReviewStampSchema, reviewDecisionRequestSchema } from "@/lib/validations/ebook-review";
import { immutableMatchingWriterInput } from "../match/link";
import { canonicalReviewJson, readReviewReceiptRecord, reviewRequestHash, verifyReviewRetry,
  verifyReviewUndoRetry, workReviewReceiptSeedSchema, reviewPayloadHash, reviewUndoOperationId,
  REVIEW_RECEIPT_EVENTS, type ReviewReceipt } from "./receipts";
import { activityRawSnapshotSql, reviewTimestampIsValidSql, reviewTimestampSql,
  reviewNullableUuidSql } from "./store-sql";
import { ReviewError, REVIEW_SQL_ERRORS } from "./errors";

export type WorkReceipt = Extract<ReviewReceipt, { entityType: "work" }>;
export type WorkRequest = Extract<z.output<typeof reviewDecisionRequestSchema>, { action: "mark_accessioned" }>;
export type WorkSeed = Omit<WorkReceipt, "after">;
export interface WorkBeforeRead {
  workId: string; stamp: WorkReceipt["before"]; rawWorkText: string;
  historyTexts: readonly string[]; activeLinkedCopy: boolean;
}
interface WorkActivityRow {
  id: string; entityType: "work"; entityId: string; eventKey: string;
  metadata: { extra: { ebookReview: WorkReceipt; workReviewAfterRaw: string } };
}
export interface VerifiedWorkRecord { row: WorkActivityRow; receipt: WorkReceipt; rawSnapshotText: string; rawWorkAfterText: string }
const same = (a: unknown, b: unknown) => canonicalReviewJson(a) === canonicalReviewJson(b);
const TABLES = ["works", "work_status_history", "editions", "instances", "instance_status_history",
  "ebooks", "ebook_files", "orders", "order_status_history", "activity_events"];
const MARKER = "durtal.work.review.row.v1";
const ROW = sql`a.id,a.entity_type as "entityType",a.entity_id as "entityId",a.event_key as "eventKey",a.metadata`;
function normalizedRow(alias: string, times: readonly string[]): SQL {
  const row = sql.identifier(alias);
  return times.length ? sql`(to_jsonb(${row}) || jsonb_build_object(${sql.join(times.flatMap((key) => [
    sql`${key}::text`, reviewTimestampSql(sql`${row}.${sql.identifier(key)}`),
  ]), sql`, `)}))::text` : sql`to_jsonb(${row})::text`;
}
function validTimes(alias: string, times: readonly string[]) {
  return sql.join(times.map((key) => {
    const field = sql`${sql.identifier(alias)}.${sql.identifier(key)}`;
    return sql`(${field} is null or ${reviewTimestampIsValidSql(field)})`;
  }), sql` and `);
}
const WORK_TIMES = ["created_at", "updated_at"];
const HISTORY_TIMES = ["changed_at"];
function historyTexts(except?: string): SQL {
  return sql`(select coalesce(jsonb_agg(${normalizedRow("h", HISTORY_TIMES)} order by h.changed_at,h.id), '[]'::jsonb)
    from work_status_history h where h.work_id=w.id ${except ? sql`and h.id<>${except}::uuid` : sql``})`;
}
function hashText(value: SQL) { return sql`encode(sha256(convert_to(${value}::text,'UTF8')),'hex')`; }
/** Complete dependency rows, not counts. Normalize database timestamps before
 * hashing so guards preserve microseconds across session timezones. */
const DEPENDENCIES = [
  { table: "editions", times: ["created_at", "updated_at", "metadata_last_fetched"], where: sql`r.work_id=w.id` },
  { table: "instances", times: ["created_at", "updated_at"], where: sql`r.edition_id in (select id from editions where work_id=w.id)` },
  { table: "instance_status_history", times: ["changed_at"], where: sql`r.instance_id in
    (select i.id from instances i join editions d on d.id=i.edition_id where d.work_id=w.id)` },
  { table: "ebooks", times: ["created_at", "updated_at", "matched_at"], where: sql`r.instance_id in
    (select i.id from instances i join editions d on d.id=i.edition_id where d.work_id=w.id)` },
  { table: "ebook_files", times: ["created_at", "updated_at", "verified_at", "source_mtime"], where: sql`r.ebook_id in
    (select e.id from ebooks e join instances i on i.id=e.instance_id join editions d on d.id=i.edition_id where d.work_id=w.id)` },
  { table: "orders", times: ["created_at", "updated_at"], where: sql`r.work_id=w.id` },
  { table: "order_status_history", times: ["changed_at"], where: sql`r.order_id in (select id from orders where work_id=w.id)` },
] as const;
function dependencyFingerprint(): SQL {
  return hashText(sql`jsonb_build_object(${sql.join(DEPENDENCIES.flatMap(({ table, times, where }) => [
    sql`${table}::text`, sql`(select coalesce(jsonb_agg(${normalizedRow("r", times)} order by r.id),'[]'::jsonb)
      from ${sql.identifier(table)} r where ${where})`,
  ]), sql`, `)})`);
}
function snapshotValid(): SQL {
  return sql`(${reviewTimestampIsValidSql(sql`w.created_at`)} and ${reviewTimestampIsValidSql(sql`w.updated_at`)}
    and not exists(select 1 from work_status_history h where h.work_id=w.id and
      (not (${validTimes("h", HISTORY_TIMES)}) or not (${reviewNullableUuidSql(sql`h.id`)})))
    and ${sql.join(DEPENDENCIES.map(({ table, times, where }) => sql`not exists(select 1 from ${sql.identifier(table)} r
      where ${where} and not (${validTimes("r", times)}))`), sql` and `)}) IS TRUE`;
}
function workStampSql(): SQL {
  return sql`jsonb_build_object('updatedAt',${reviewTimestampSql(sql`w.updated_at`)},
    'catalogueStatus',w.catalogue_status,'historyFingerprint',${hashText(historyTexts())},
    'dependencyFingerprint',${dependencyFingerprint()},'latestHistoryId',
    (select h.id from work_status_history h where h.work_id=w.id order by h.changed_at desc,h.id desc limit 1))`;
}
function activeLinkedCopy(): SQL {
  return sql`exists(select 1 from ebooks e join instances i on i.id=e.instance_id join editions d on d.id=i.edition_id
    where d.work_id=w.id and e.match_state='linked' and i.status<>'deaccessioned')`;
}
export async function readWorkReviewBeforeOn(conn: Db, id: string): Promise<WorkBeforeRead | null> {
  const workId = z.uuid().parse(id).toLowerCase();
  const rows = resultRows<WorkBeforeRead & { valid: boolean }>(await conn.execute(sql`
    select w.id as "workId",${workStampSql()} as stamp,${normalizedRow("w", WORK_TIMES)} as "rawWorkText",
      ${historyTexts()} as "historyTexts",${activeLinkedCopy()} as "activeLinkedCopy",${snapshotValid()} as valid
    from works w where w.id=${workId}::uuid and w.kind='book'`));
  if (!rows.length) return null;
  if (rows.length !== 1 || !rows[0].valid) throw new ReviewError("stale_review", "The book snapshot cannot be reviewed.");
  const { valid: _valid, ...before } = rows[0];
  return immutableMatchingWriterInput({ ...before, stamp: workReviewStampSchema.parse(before.stamp) });
}
export function assertWorkStatusEligible(before: WorkBeforeRead) {
  if (!before.activeLinkedCopy || !["tracked", "shortlisted", "wanted", "on_order"].includes(before.stamp.catalogueStatus))
    throw new ReviewError("ineligible_state", "This book is no longer partially held.");
}
export async function readWorkReviewReceiptOn(conn: Db, operationId: string): Promise<VerifiedWorkRecord | null> {
  const id = z.uuid().parse(operationId).toLowerCase();
  const rows = resultRows<WorkActivityRow & { rawSnapshotText: string; valid: boolean }>(await conn.execute(sql`
    select ${ROW},${activityRawSnapshotSql()} as "rawSnapshotText",${reviewTimestampIsValidSql(sql`a.created_at`)} as valid
    from activity_events a where a.id=${id}::uuid`));
  if (!rows.length) return null;
  try {
    if (rows.length !== 1 || !rows[0].valid) throw new Error("Invalid audit snapshot");
    const receipt = readReviewReceiptRecord(rows[0]);
    if (receipt.entityType !== "work") throw new Error("Wrong receipt namespace");
    const rawWorkAfterText = z.string().min(1).parse(rows[0].metadata.extra.workReviewAfterRaw);
    return immutableMatchingWriterInput({ row: rows[0], receipt, rawSnapshotText: rows[0].rawSnapshotText, rawWorkAfterText });
  } catch (cause) { throw new ReviewError("operation_collision", "The work operation key cannot be verified.", { cause }); }
}
function recordGuard(record: VerifiedWorkRecord): SQL {
  return sql`exists(select 1 from activity_events a where a.id=${record.receipt.operation.operationId}::uuid
    and ${reviewTimestampIsValidSql(sql`a.created_at`)} and ${activityRawSnapshotSql()}=${record.rawSnapshotText})`;
}
function validateRecord(record: VerifiedWorkRecord) {
  const parsed = readReviewReceiptRecord(record.row);
  if (parsed.entityType !== "work" || !same(parsed, record.receipt) || !record.rawSnapshotText ||
      !record.rawWorkAfterText || record.rawWorkAfterText !== record.row.metadata.extra.workReviewAfterRaw)
    throw new ReviewError("invalid_receipt", "The work receipt evidence changed.");
}
export function verifyWorkRetry(record: VerifiedWorkRecord, request: WorkRequest) {
  try { validateRecord(record); verifyReviewRetry(record.row, request); }
  catch (cause) { throw new ReviewError("operation_collision", "The work operation belongs to another request.", { cause }); }
}
export function verifyWorkUndoRetry(record: VerifiedWorkRecord, original: VerifiedWorkRecord) {
  try { validateRecord(record); validateRecord(original); verifyReviewUndoRetry(record.row, original.row); }
  catch (cause) { throw new ReviewError("operation_collision", "The work Undo operation cannot be verified.", { cause }); }
}
/** Ledger-only replay remains possible after target deletion or cache loss. */
export async function replayWorkReviewOn(conn: Db, record: VerifiedWorkRecord, request: WorkRequest | VerifiedWorkRecord): Promise<WorkReceipt> {
  const { stored, binding } = immutableMatchingWriterInput({ stored: record, binding: request });
  if ("receipt" in binding) verifyWorkUndoRetry(stored, binding); else verifyWorkRetry(stored, binding);
  const records = "receipt" in binding ? [stored, binding] : [stored];
  const result = await atomicOn(conn, (d) => [d.execute(lockSql(["activity_events"])),
    ...records.map((row) => d.execute(assertSql(recordGuard(row), REVIEW_SQL_ERRORS.stale))),
    d.execute(sql`select ${ROW} from activity_events a where a.id=${stored.receipt.operation.operationId}::uuid`),
  ]);
  const rows = resultRows<WorkActivityRow>(result.at(-1));
  if (rows.length !== 1) throw new ReviewError("invalid_receipt", "The work receipt disappeared during replay.");
  const receipt = "receipt" in binding ? verifyReviewUndoRetry(rows[0], binding.row) : verifyReviewRetry(rows[0], binding);
  if (receipt.entityType !== "work") throw new ReviewError("invalid_receipt", "Wrong receipt namespace.");
  return immutableMatchingWriterInput(receipt);
}

export interface WorkStatusWrite {
  before: WorkBeforeRead; seed: WorkSeed; historyId: string;
  request?: WorkRequest; original?: VerifiedWorkRecord;
}
/** Owns the status/history/audit atomic. No instance, order, eBook or matching
 * mutation is scheduled here. All assertions run before its terminal result. */
export async function writeWorkReviewOn(conn: Db, input: WorkStatusWrite): Promise<WorkReceipt> {
  const frozen = immutableMatchingWriterInput(input), { before, original } = frozen;
  const seed = workReviewReceiptSeedSchema.parse(frozen.seed), historyId = z.uuid().parse(frozen.historyId).toLowerCase();
  workReviewStampSchema.parse(before.stamp);
  if (seed.entityId !== before.workId || !same(seed.before, before.stamp) || historyId === before.stamp.latestHistoryId ||
      seed.eventKey !== (original ? REVIEW_RECEIPT_EVENTS.workUndo : REVIEW_RECEIPT_EVENTS.workDecision) ||
      seed.action !== (original ? "undo" : "mark_accessioned") ||
      (!!original !== (seed.action === "undo")) || (!!original === !!frozen.request))
    throw new ReviewError("invalid_receipt", "The work change is not bound to its snapshot.");
  let toStatus: WorkReceipt["after"]["catalogueStatus"];
  if (original) {
    validateRecord(original);
    if (original.receipt.action !== "mark_accessioned" || !same(original.receipt.after, before.stamp) ||
        original.receipt.entityId !== before.workId || original.rawWorkAfterText !== before.rawWorkText ||
        !same(seed.originalOperation, original.receipt.operation) ||
        seed.effectHash !== original.receipt.effectHash)
      throw new ReviewError("stale_review", "The book has a later status, history or dependency change.");
    toStatus = original.receipt.before.catalogueStatus;
    // The real receipt verifier checks deterministic identity, request hash and
    // exact before binding once the actual after state exists, still in SQL.
    const expectedRequestHash = reviewPayloadHash({ action: "undo", entityType: "work", entityId: before.workId,
      originalOperation: original.receipt.operation });
    if (seed.requestHash !== expectedRequestHash || seed.operation.operationId !== reviewUndoOperationId(original.receipt.operation) ||
        seed.operation.runId !== original.receipt.operation.runId ||
        seed.operation.targetDatabase !== original.receipt.operation.targetDatabase || seed.operation.planSha256 !== original.receipt.operation.planSha256)
      throw new ReviewError("invalid_receipt", "Work compensation identity changed.");
  } else {
    assertWorkStatusEligible(before); toStatus = "accessioned";
    const request = reviewDecisionRequestSchema.parse(frozen.request);
    if (request.action !== "mark_accessioned" || !same(request.stamp, before.stamp) ||
        request.workId !== before.workId || !same(request.operation, seed.operation) ||
        request.effectHash !== seed.effectHash || seed.requestHash !== reviewRequestHash(request) || seed.originalOperation !== null)
      throw new ReviewError("invalid_receipt", "The work receipt does not bind the confirmed request.");
  }
  const final = sql`exists(select 1 from works w join activity_events a on a.id=${seed.operation.operationId}::uuid
    where w.id=${before.workId}::uuid and w.kind='book' and ${snapshotValid()}
      and ${normalizedRow("w", WORK_TIMES)}::jsonb = ${before.rawWorkText}::jsonb ||
        jsonb_build_object('catalogue_status',${toStatus}::text,'updated_at',${reviewTimestampSql(sql`w.updated_at`)})
      and w.updated_at>${before.stamp.updatedAt}::timestamptz and w.catalogue_status=${toStatus}::catalogue_status_enum
      and ${dependencyFingerprint()}=${before.stamp.dependencyFingerprint}
      and ${historyTexts(historyId)}=${JSON.stringify(before.historyTexts)}::jsonb
      and (${workStampSql()}->>'latestHistoryId')=${historyId}
      and (${workStampSql()}->>'historyFingerprint')<>${before.stamp.historyFingerprint}
      and exists(select 1 from work_status_history h where h.id=${historyId}::uuid and h.work_id=w.id
        and h.from_status=${before.stamp.catalogueStatus}::catalogue_status_enum and h.to_status=${toStatus}::catalogue_status_enum
        and h.changed_at=w.updated_at and h.notes='eBook review')
      and a.entity_type='work' and a.entity_id=w.id and a.event_key=${seed.eventKey}
      and ${reviewTimestampIsValidSql(sql`a.created_at`)}
      and a.metadata->'extra'->>'workReviewAfterRaw'=${normalizedRow("w", WORK_TIMES)}
      and a.metadata->'extra'->'ebookReview'=${JSON.stringify(seed)}::jsonb || jsonb_build_object('after',${workStampSql()}))`;
  const results = await atomicOn(conn, (d) => [
    d.execute(lockSql(TABLES)),
    d.execute(sql`select id from works where id=${before.workId}::uuid for update`),
    d.execute(assertSql(sql`not exists(select 1 from activity_events where id=${seed.operation.operationId}::uuid)`, REVIEW_SQL_ERRORS.collision)),
    d.execute(assertSql(sql`exists(select 1 from works w where w.id=${before.workId}::uuid and w.kind='book'
      and ${snapshotValid()} and ${normalizedRow("w", WORK_TIMES)}=${before.rawWorkText}
      and ${workStampSql()}=${JSON.stringify(before.stamp)}::jsonb
      ${original ? sql`` : sql`and ${activeLinkedCopy()}`})`, REVIEW_SQL_ERRORS.stale)),
    ...(original ? [d.execute(assertSql(recordGuard(original), REVIEW_SQL_ERRORS.stale))] : []),
    d.execute(sql`update works w set catalogue_status=${toStatus}::catalogue_status_enum,
      updated_at=greatest(clock_timestamp(),w.updated_at+interval '1 microsecond',
        coalesce((select max(h.changed_at)+interval '1 microsecond' from work_status_history h where h.work_id=w.id),w.updated_at))
      where w.id=${before.workId}::uuid`),
    d.execute(sql`insert into work_status_history(id,work_id,from_status,to_status,changed_at,notes)
      select ${historyId}::uuid,w.id,${before.stamp.catalogueStatus}::catalogue_status_enum,w.catalogue_status,w.updated_at,'eBook review'
      from works w where w.id=${before.workId}::uuid`),
    d.execute(sql`insert into activity_events(id,entity_type,entity_id,event_key,metadata)
      select ${seed.operation.operationId}::uuid,'work',w.id,${seed.eventKey},jsonb_build_object('extra',
        jsonb_build_object('ebookReview',${JSON.stringify(seed)}::jsonb || jsonb_build_object('after',${workStampSql()}),
          'workReviewAfterRaw',${normalizedRow("w", WORK_TIMES)}))
      from works w where w.id=${before.workId}::uuid`),
    d.execute(assertSql(final, REVIEW_SQL_ERRORS.invalid)),
    ...(original ? [d.execute(assertSql(recordGuard(original), REVIEW_SQL_ERRORS.stale))] : []),
    d.execute(sql`select ${ROW},${MARKER}::text as "__workReviewResult" from activity_events a
      where a.id=${seed.operation.operationId}::uuid`),
  ]);
  const rows = resultRows<WorkActivityRow & { __workReviewResult: string }>(results.at(-1));
  if (rows.length !== 1 || rows[0].__workReviewResult !== MARKER)
    throw new ReviewError("invalid_receipt", "The work writer did not return its authoritative receipt.");
  const receipt = original ? verifyReviewUndoRetry(rows[0], original.row) : verifyReviewRetry(rows[0], frozen.request);
  if (receipt.entityType !== "work") throw new ReviewError("invalid_receipt", "Wrong receipt namespace.");
  const { after: _after, ...actualSeed } = receipt;
  if (!same(actualSeed, seed)) throw new ReviewError("invalid_receipt", "The work receipt seed changed.");
  return immutableMatchingWriterInput(receipt);
}
