import { uploadRowSnapshotSql, uploadTableSnapshotSql, requireCanonicalUploadRow, UPLOAD_READER_TABLES, UPLOAD_TARGET_TABLES } from "./atomic-snapshots";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import type { Db } from "@/lib/catalogue/work-store";
import { assertSql } from "@/lib/harmonization/store";
import { reviewOperationSchema, reviewTimestampSchema } from "@/lib/validations/ebook-review";
import { immutableMatchingWriterInput } from "../match/writer-input";
import type { MatchOperationIdentity } from "../match/types";
import { canonicalReviewJson, reviewPayloadHash } from "../review/receipts";
import { acceptedPublication } from "../publication-evidence";

const uuid = z.uuid().transform((id) => id.toLowerCase());
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const row = z.record(z.string(), z.unknown());
const targetSchema = z.strictObject({
  ebooks: z.array(row), ebook_files: z.array(row),
  ebook_positions: z.array(row), ebook_annotations: z.array(row),
  ebook_ingest_runs: z.array(row), ebook_ingest_items: z.array(row),
  ebook_annotation_retired_ids: z.array(row), ebook_annotation_cursors: z.array(row), reading_notes: z.array(row),
});
const fileSchema = z.strictObject({
  id: uuid, ebookId: uuid, sha256: hash, format: z.string().min(1),
  sizeBytes: z.number().int().min(1).max(4294967296),
  s3Key: z.string().min(1), manifestKey: z.string().min(1), metadata: row,
});
const outcomeSchema = z.strictObject({ operationId: uuid, key: uuid, status: z.union([z.literal(200), z.literal(201)]),
  message: z.string().max(900), preview: z.null() });
const receiptSchema = z.union([outcomeSchema, z.strictObject({ version: z.literal(1),
  request: z.strictObject({ key: uuid, kind: z.enum(["complete", "restore", "undo"]), requestSha256: hash,
    targetFingerprint: hash, bindingSha256: hash }), operationId: uuid, parentOperationId: uuid,
  status: z.union([z.literal(200), z.literal(201)]), result: outcomeSchema, effect: z.null() })]);
function outcomeOf(receipt: z.output<typeof receiptSchema>) {
  return "result" in receipt ? receipt.result : receipt;
}
const bindingSchema = z.strictObject({
  version: z.literal(1), purpose: z.enum(["effect", "restore", "compensation"]), expiresAt: reviewTimestampSchema,
  coreWriter: z.enum(["registration", "restore_registration", "compensate_registration", "link", "accession", "decision", "classification", "undo_link"]),
  coreOperation: reviewOperationSchema, databaseFingerprint: z.string().regex(/^[a-f0-9]{16}$/), ebookIds: z.array(uuid).length(1),
  command: z.strictObject({ id: uuid, key: uuid, requestSha256: hash, targetFingerprint: hash,
    bindingSha256: hash, volumeId: uuid, runId: uuid, rawSnapshot: row }),
  owner: z.strictObject({ token: uuid, fence: counter, capacitySnapshot: row }),
  job: z.strictObject({ id: uuid, generation: counter, mode: z.enum(["leased", "settled"]),
    leaseToken: uuid.nullable(), rawSnapshot: row }),
  targetSnapshot: targetSchema,
  publication: z.array(fileSchema).length(1),
  receipt: receiptSchema,
  previewTokenSha256: hash,
  activityId: uuid,
  original: z.strictObject({ operationId: uuid, receipt: row, activityId: uuid, coreOperation: reviewOperationSchema,
    coreWriter: z.enum(["registration", "link", "accession", "decision", "classification"]),
    catalogueBefore: z.strictObject({ ebooks: z.array(row), ebook_files: z.array(row) }),
    catalogueAfter: z.strictObject({ ebooks: z.array(row), ebook_files: z.array(row) }) }).optional(),
});
export type UploadAtomicBinding = z.output<typeof bindingSchema>;
export type UploadCoreWriter = UploadAtomicBinding["coreWriter"];
export interface UploadAtomicQueries {
  before(d: Db): readonly unknown[];
  /** The actual496 store captures final DB state and writes the permanent
   * receipt/activity here. The registry verifies both and returns the actual
   * stored receipt last; it never fabricates an after-state. */
  after(d: Db): readonly unknown[];
}
const brand: unique symbol = Symbol("prepared core upload extension");
export interface PreparedUploadAtomicExtension {
  readonly [brand]: true;
  readonly extraTables: readonly string[];
  before(d: Db): readonly unknown[];
  after(d: Db): readonly unknown[];
}
const prepared = new WeakSet<object>();
const bindings = new WeakMap<object, UploadAtomicBinding>();
export const UPLOAD_ATOMIC_TABLES = Object.freeze([
  "activity_events", "ebook_upload_capacity", "ebook_upload_operations", "ebook_ingest_runs", "ebook_ingest_items",
  "ebooks", "ebook_files", "ebook_positions", "ebook_annotations", "ebook_annotation_retired_ids",
  "ebook_annotation_cursors", "reading_notes", "ebook_match_candidates", "instances", "editions", "works",
]);
const same = (a: unknown, b: unknown) => canonicalReviewJson(a) === canonicalReviewJson(b);
const operationOf = (o: MatchOperationIdentity) => reviewOperationSchema.parse({ version: o.version,
  operationId: o.operationId, runId: o.runId, planSha256: o.planSha256, targetDatabase: o.targetDatabase });
function requireTrue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
export function parseUploadAtomicBinding(input: unknown): UploadAtomicBinding {
  const b = bindingSchema.parse(immutableMatchingWriterInput(input));
  // Also reject unsupported JSON inside raw snapshots/metadata before any SQL.
  canonicalReviewJson(b);
  const c = b.command.rawSnapshot, capacity = b.owner.capacitySnapshot, j = b.job.rawSnapshot;
  requireTrue(b.coreOperation.targetDatabase === b.databaseFingerprint &&
    b.command.targetFingerprint === reviewPayloadHash({ namespace: "durtal.upload.target.v1", database: b.databaseFingerprint }) && b.coreOperation.runId === b.command.runId &&
    outcomeOf(b.receipt).operationId === b.command.id && outcomeOf(b.receipt).key === b.command.key &&
    c.id === b.command.id && c.id !== j.id && c.parent_operation_id === j.id &&
    ["complete", "restore", "undo"].includes(String(c.kind)) &&
    (c.input as Record<string, unknown>)?.action === "confirm" && c.idempotency_key === b.command.key && c.request_sha256 === b.command.requestSha256 &&
    c.target_fingerprint === b.command.targetFingerprint && c.binding_sha256 === b.command.bindingSha256 &&
    c.volume_id === b.command.volumeId && c.run_id === b.command.runId && c.protocol_version === 1 &&
    c.receipt === null && c.receipt_status === null && c.effect_committed_at === null &&
    capacity.volume_id === b.command.volumeId && capacity.binding_sha256 === b.command.bindingSha256 &&
    capacity.owner_token === b.owner.token && Number(capacity.owner_fence) === b.owner.fence &&
    j.id === b.job.id && j.kind === "upload" && j.run_id === b.command.runId &&
    j.volume_id === b.command.volumeId && j.binding_sha256 === b.command.bindingSha256 &&
    j.target_fingerprint === b.command.targetFingerprint && Number(j.generation) === b.job.generation,
    "Upload capability identity differs from its actual source snapshots");
  requireTrue((b.purpose !== "effect") === !!b.original &&
    (b.coreWriter === "compensate_registration" || b.coreWriter === "undo_link" ? b.purpose === "compensation" :
     b.coreWriter === "restore_registration" ? b.purpose === "restore" : b.purpose !== "restore") &&
    (b.coreWriter !== "registration" && b.coreWriter !== "link" && b.coreWriter !== "accession" && b.coreWriter !== "decision" || b.purpose === "effect"),
    "Upload effect, restore and compensation purposes differ");
  if ("result" in b.receipt) requireTrue(b.receipt.operationId === b.command.id && b.receipt.parentOperationId === b.job.id &&
    b.receipt.status === b.receipt.result.status && b.receipt.request.key === b.command.key &&
    b.receipt.request.kind === c.kind && b.receipt.request.requestSha256 === b.command.requestSha256 &&
    b.receipt.request.targetFingerprint === b.command.targetFingerprint && b.receipt.request.bindingSha256 === b.command.bindingSha256,
    "Upload receipt envelope differs from its command");
  if (b.original) requireTrue(b.original.operationId !== b.command.id &&
    b.original.receipt.operationId === b.original.operationId && outcomeOf(receiptSchema.parse(b.original.receipt)).key !== b.command.key &&
    b.original.coreOperation.runId === b.coreOperation.runId &&
    b.original.coreOperation.targetDatabase === b.coreOperation.targetDatabase &&
    same(b.original.catalogueAfter.ebooks, b.targetSnapshot.ebooks) &&
    same(b.original.catalogueAfter.ebook_files, b.targetSnapshot.ebook_files),
    "Upload restoration requires an independent key and the original exact catalogue after-state");
  requireTrue((b.job.mode === "leased") === (b.job.leaseToken !== null) && j.lease_token === b.job.leaseToken, "Upload worker lease mode differs");
  for (const file of b.publication) {
    requireTrue(file.ebookId === b.ebookIds[0] && acceptedPublication(file.metadata, {
      sha256: file.sha256, format: file.format, sizeBytes: file.sizeBytes, s3Key: file.s3Key, manifestKey: file.manifestKey,
    }) !== null, "Upload lacks canonical validated stage publication");
    const stages = acceptedPublication(file.metadata, { sha256: file.sha256, format: file.format,
      sizeBytes: file.sizeBytes, s3Key: file.s3Key, manifestKey: file.manifestKey })!;
    requireTrue(stages.gold.at(-1)?.key === file.manifestKey, "Upload publication marker differs");
  }
  const scope = { ebookIds: b.ebookIds, runId: b.command.runId };
  requireCanonicalUploadRow("ebook_upload_operations", c);
  requireCanonicalUploadRow("ebook_upload_operations", j);
  requireCanonicalUploadRow("ebook_upload_capacity", capacity);
  for (const table of UPLOAD_TARGET_TABLES) for (const value of b.targetSnapshot[table]) {
    requireCanonicalUploadRow(table, value);
    requireTrue(table === "ebook_ingest_runs" ? value.id === scope.runId : table === "ebook_ingest_items" ? value.run_id === scope.runId :
      table === "reading_notes" ? b.targetSnapshot.ebook_annotations.some((a) => a.id === value.ebook_annotation_id) ||
        b.targetSnapshot.ebook_annotation_retired_ids.some((a) => a.id === value.ebook_annotation_id) :
        table === "ebooks" ? b.ebookIds.includes(String(value.id)) : b.ebookIds.includes(String(value.ebook_id)),
      "Upload snapshot contains rows outside its bound target scope");
  }
  // Actual496 inspection is durable before IDs are allocated for a preview.
  // Compare verified source/publication facts rather than demanding future
  // ebook/file IDs in the inspection receipt. The command persists the exact
  // held preview binding before this capability is issued.
  const progress = j.progress as Record<string, unknown>;
  const inspection = progress?.inspectionV1 as Record<string, unknown> | undefined;
  const inspected = inspection?.prepared as Record<string, unknown> | undefined;
  const inspectionReceipt = j.receipt as Record<string, unknown> | null;
  const inspectionRequest = inspectionReceipt?.request as Record<string, unknown> | undefined;
  const inspectionOutcome = inspectionReceipt?.result as Record<string, unknown> | undefined;
  requireTrue(inspection && inspected && inspection.version === 1 && inspectionReceipt &&
    inspectionReceipt.version === 1 && inspectionReceipt.status === 200 && inspectionRequest && inspectionOutcome &&
    inspectionRequest.kind === "upload" && inspectionRequest.key === j.idempotency_key &&
    inspectionRequest.requestSha256 === j.request_sha256 && inspectionRequest.targetFingerprint === b.command.targetFingerprint &&
    inspectionRequest.bindingSha256 === b.command.bindingSha256 && inspectionOutcome.operationId === j.id &&
    inspectionOutcome.key === j.idempotency_key && inspectionOutcome.status === 200 && inspectionOutcome.preview === null &&
    inspectionReceipt.inspectionSha256 === reviewPayloadHash(inspection) && inspectionReceipt.operationId === j.id &&
    j.receipt_status === 200, "Upload lacks its actual durable verified inspection receipt");
  if (b.purpose === "effect") {
    const file = b.publication[0];
    requireTrue(inspected.sha256 === file.sha256 && inspected.format === file.format && inspected.size === file.sizeBytes &&
      same(inspection.metadata, file.metadata) && (j.input as Record<string, unknown>).sha256 === file.sha256 && Number(j.source_size_bytes) === file.sizeBytes,
      "Upload preview publication differs from its actual verified inspection");
  } else for (const file of b.publication) {
    const retained = b.targetSnapshot.ebook_files.find((row) => row.id === file.id);
    requireTrue(retained && retained.ebook_id === file.ebookId && retained.sha256 === file.sha256 &&
      retained.format === file.format && Number(retained.size_bytes) === file.sizeBytes && retained.s3_key === file.s3Key &&
      retained.manifest_key === file.manifestKey && same(retained.metadata, file.metadata),
      "Upload restoration publication differs from its retained original file");
  }
  const preview = (c.progress as Record<string, unknown>)?.uploadCoreV1 as Record<string, unknown> | undefined;
  requireTrue(preview && preview.previewTokenSha256 === b.previewTokenSha256 && preview.expiresAt === b.expiresAt &&
    same(preview.coreOperation, b.coreOperation) && same(preview.publication, b.publication),
    "Upload command does not durably bind its exact held preview plan/publication");
  return immutableMatchingWriterInput(b);
}
function ownerCondition(b: UploadAtomicBinding): SQL {
  return sql`c.volume_id=${b.command.volumeId}::uuid and c.binding_sha256=${b.command.bindingSha256}
    and c.owner_token=${b.owner.token}::uuid and c.owner_fence=${b.owner.fence}
    and c.owner_lease_expires_at > clock_timestamp() and c.state='ready'
    and c.quota_bytes=34359738368 and c.free_reserve_bytes=8589934592 and c.global_allowance_bytes=83886080
    and c.reserved_bytes >= c.global_allowance_bytes
    and c.unaccounted_bytes >= 0 and c.reserved_bytes+c.unaccounted_bytes <= c.quota_bytes
    and clock_timestamp() < ${b.expiresAt}::timestamptz`;
}
function jobCondition(b: UploadAtomicBinding): SQL {
  return sql`j.id=${b.job.id}::uuid and j.volume_id=c.volume_id and j.binding_sha256=c.binding_sha256
    and j.run_id=${b.command.runId}::uuid and j.target_fingerprint=${b.command.targetFingerprint}
    and j.generation=${b.job.generation} and j.kind='upload'
    and j.reservation_released_at is null and j.reserved_bytes = 2*((j.source_size_bytes+65535)/65536)*65536+553648128
    and c.reserved_bytes >= j.reserved_bytes+c.global_allowance_bytes and c.active_part_writers=0
    and coalesce(j.progress #> '{uploadV1,writers}','{}'::jsonb)='{}'::jsonb
    and ${b.job.mode === "leased" ? sql`j.state in ('processing','ready') and j.lease_token=${b.job.leaseToken}::uuid
      and j.lease_expires_at > clock_timestamp() and c.worker_operation_id=j.id
      and c.worker_token=j.lease_token and c.worker_state='running'
      and c.worker_lease_expires_at > clock_timestamp()
      and c.available_bytes is not null and c.available_bytes >= c.free_reserve_bytes`
      : sql`j.lease_token is null and j.lease_expires_at is null and j.cleanup_verified_at is not null
        and c.worker_state='idle' and c.worker_operation_id is null and c.worker_token is null
        and j.state='ready' and j.receipt is not null and j.receipt_status=200
        and isfinite(j.cleanup_verified_at)
        and c.worker_lease_expires_at is null and c.active_part_writers=0`}`;
}
function prefix(d: Db, b: UploadAtomicBinding): unknown[] {
  return [d.execute(assertSql(sql`exists(select 1 from ebook_upload_capacity c
    join ebook_upload_operations o on o.volume_id=c.volume_id
    join ebook_upload_operations j on j.volume_id=c.volume_id
    where ${ownerCondition(b)} and ${jobCondition(b)} and o.id=${b.command.id}::uuid
      and ${uploadRowSnapshotSql("ebook_upload_capacity", "c") }=${JSON.stringify(b.owner.capacitySnapshot)}::jsonb
      and ${uploadRowSnapshotSql("ebook_upload_operations", "o") }=${JSON.stringify(b.command.rawSnapshot)}::jsonb
      and ${uploadRowSnapshotSql("ebook_upload_operations", "j") }=${JSON.stringify(b.job.rawSnapshot)}::jsonb
      and o.receipt is null and o.receipt_status is null and o.effect_committed_at is null)`, "Upload owner, job, operation or capacity changed")),
    ...UPLOAD_TARGET_TABLES.map((table) => d.execute(assertSql(sql`
      ${uploadTableSnapshotSql(table, { ebookIds: b.ebookIds, runId: b.command.runId })}=${JSON.stringify(b.targetSnapshot[table])}::jsonb`,
      "Upload target or reader snapshot changed"))),
    ...(b.original ? [d.execute(assertSql(sql`exists(select 1 from ebook_upload_operations o
      join activity_events a on a.id=${b.original.activityId}::uuid
      where o.id=${b.original.operationId}::uuid and o.receipt=${JSON.stringify(b.original.receipt)}::jsonb
        and o.effect_committed_at is not null and o.target_fingerprint=${b.command.targetFingerprint}
        and o.binding_sha256=${b.command.bindingSha256} and o.run_id=${b.command.runId}::uuid
        and a.entity_type='ebook' and a.entity_id=${b.ebookIds[0]}::uuid and a.event_key='ebook.upload.effect.v1'
        and a.metadata #>> '{extra,ebookUpload,coreWriter}'=${b.original.coreWriter}
        and a.metadata #> '{extra,ebookUpload,coreOperation}'=${JSON.stringify(b.original.coreOperation)}::jsonb
        and a.metadata #> '{extra,ebookUpload,catalogueBefore}'=${JSON.stringify(b.original.catalogueBefore)}::jsonb
        and a.metadata #> '{extra,ebookUpload,catalogueAfter}'=${JSON.stringify(b.original.catalogueAfter)}::jsonb
        and a.metadata #>> '{extra,ebookUpload,operationId}'=${b.original.operationId})`,
      "Original upload receipt or exact after-state changed"))] : [])];
}
function finalQueries(d: Db, b: UploadAtomicBinding): unknown[] {
  const event = b.purpose === "compensation" ? "ebook.upload.compensation.v1" : b.purpose === "restore" ? "ebook.upload.restore.v1" : "ebook.upload.effect.v1";
  return [d.execute(assertSql(sql`exists(select 1 from ebook_upload_capacity c
    join ebook_upload_operations o on o.volume_id=c.volume_id
    join ebook_upload_operations j on j.volume_id=c.volume_id
    join activity_events a on a.id=${b.activityId}::uuid
    where ${ownerCondition(b)} and ${jobCondition(b)} and o.id=${b.command.id}::uuid
      and ${uploadRowSnapshotSql("ebook_upload_capacity", "c") }=${JSON.stringify(b.owner.capacitySnapshot)}::jsonb
      and ${uploadRowSnapshotSql("ebook_upload_operations", "j") }=${JSON.stringify(b.job.rawSnapshot)}::jsonb
      and o.idempotency_key=${b.command.key}::uuid and o.request_sha256=${b.command.requestSha256}
      and o.target_fingerprint=${b.command.targetFingerprint} and o.binding_sha256=${b.command.bindingSha256}
      and o.run_id=${b.command.runId}::uuid and o.protocol_version=1
      and o.receipt=${JSON.stringify(b.receipt)}::jsonb and o.receipt_status=${outcomeOf(b.receipt).status}
      and o.effect_committed_at is not null and isfinite(o.effect_committed_at)
      and a.entity_type='ebook' and a.entity_id=${b.ebookIds[0]}::uuid and a.event_key=${event}
      and a.metadata #>> '{extra,ebookUpload,coreWriter}'=${b.coreWriter}
      and a.metadata #> '{extra,ebookUpload,coreOperation}'=${JSON.stringify(b.coreOperation)}::jsonb
      and a.metadata #>> '{extra,ebookUpload,operationId}'=${b.command.id}
      and a.metadata #> '{extra,ebookUpload,catalogueBefore}'=${JSON.stringify({ ebooks: b.targetSnapshot.ebooks, ebook_files: b.targetSnapshot.ebook_files })}::jsonb
      and a.metadata #> '{extra,ebookUpload,catalogueAfter}'=jsonb_build_object(
        'ebooks',${uploadTableSnapshotSql('ebooks', { ebookIds: b.ebookIds, runId: b.command.runId })},
        'ebook_files',${uploadTableSnapshotSql('ebook_files', { ebookIds: b.ebookIds, runId: b.command.runId })}))`,
      "Upload final permanent receipt or ownership validation failed")),
    ...UPLOAD_READER_TABLES.map((table) => d.execute(assertSql(sql`
      ${uploadTableSnapshotSql(table, { ebookIds: b.ebookIds, runId: b.command.runId })}=${JSON.stringify(b.targetSnapshot[table])}::jsonb`,
      "Upload reader/annotation retirement/cursor/quote-note rows changed"))),
    d.execute(sql`select ${'durtal.ebook.upload.rows.v1'} as marker, o.receipt as receipt,
      o.receipt_status as status, case when o.receipt ? 'result' then o.receipt->'result' else o.receipt end as outcome, to_jsonb(a) as activity
      from ebook_upload_operations o join activity_events a on a.id=${b.activityId}::uuid
      where o.id=${b.command.id}::uuid`)];
}
function synchronous(build: (d: Db) => readonly unknown[], d: Db): readonly unknown[] {
  const result = build(d);
  if (!Array.isArray(result) || typeof (result as unknown as { then?: unknown }).then === "function")
    throw new Error("Upload query builders must synchronously return arrays");
  return result;
}
/** Internal registry entry. Only the server-only upload issuer imports this;
 * never a request body, browser module, review issuer or alternate writer. */
export function issueUploadAtomicExtensionInternal(binding: UploadAtomicBinding, queries: UploadAtomicQueries): PreparedUploadAtomicExtension {
  if (typeof window !== "undefined") throw new Error("Upload capability issuance is server-only");
  const b = parseUploadAtomicBinding(binding);
  if (typeof queries.before !== "function" || typeof queries.after !== "function" ||
      queries.before.constructor.name === "AsyncFunction" || queries.after.constructor.name === "AsyncFunction")
    throw new Error("Upload extension requires synchronous server builders");
  const before = queries.before.bind(queries), after = queries.after.bind(queries);
  const extension: PreparedUploadAtomicExtension = Object.freeze({ [brand]: true as const,
    extraTables: UPLOAD_ATOMIC_TABLES,
    before: (d: Db) => [...prefix(d, b), ...synchronous(before, d)],
    after: (d: Db) => [...synchronous(after, d), ...finalQueries(d, b)],
  });
  prepared.add(extension); bindings.set(extension, b); return extension;
}
export function isPreparedUploadAtomicExtension(value: unknown): value is PreparedUploadAtomicExtension {
  return typeof value === "object" && value !== null && prepared.has(value);
}
export function requireUploadAtomicExtension(extension: PreparedUploadAtomicExtension,
  expected: { coreWriter: UploadCoreWriter; coreOperation: MatchOperationIdentity; ebookIds: readonly string[]; purpose?: UploadAtomicBinding["purpose"] },
): PreparedUploadAtomicExtension {
  if (!isPreparedUploadAtomicExtension(extension)) throw new Error("Untrusted upload atomic extension");
  const b = bindings.get(extension)!;
  if (b.coreWriter !== expected.coreWriter || !same(b.coreOperation, operationOf(expected.coreOperation)) ||
      !same(b.ebookIds, [...expected.ebookIds].map((id) => uuid.parse(id)).sort()) ||
      (expected.purpose !== undefined && b.purpose !== expected.purpose))
    throw new Error("Upload extension differs from the frozen core writer, plan or scope");
  return extension;
}
export function uploadCompensationOf(extension: PreparedUploadAtomicExtension): boolean {
  if (!isPreparedUploadAtomicExtension(extension)) throw new Error("Untrusted upload atomic extension");
  return bindings.get(extension)!.purpose === "compensation";
}
export function requireUploadPublicationFiles(extension: PreparedUploadAtomicExtension, files: readonly z.output<typeof fileSchema>[]): void {
  if (!isPreparedUploadAtomicExtension(extension) || !same(bindings.get(extension)!.publication, files))
    throw new Error("Upload publication differs from actual planned registration files");
}
export function uploadForwardUpdatedAt(): SQL {
  // A non-finite existing version fails the NOT NULL update inside this atomic.
  return sql`case when isfinite(updated_at) then greatest(clock_timestamp(),updated_at+interval '1 microsecond') else null end`;
}

export function uploadOriginalCatalogueOf(extension: PreparedUploadAtomicExtension) {
  if (!isPreparedUploadAtomicExtension(extension) || !bindings.get(extension)!.original)
    throw new Error("Upload restoration requires its original permanent receipt");
  return bindings.get(extension)!.original!;
}
export function requireUploadOriginalOperation(extension: PreparedUploadAtomicExtension, operation: MatchOperationIdentity): void {
  if (!same(uploadOriginalCatalogueOf(extension).coreOperation, operationOf(operation)))
    throw new Error("Upload undo differs from the original native matching receipt");
}
export function uploadTargetSnapshotOf(extension: PreparedUploadAtomicExtension) {
  if (!isPreparedUploadAtomicExtension(extension)) throw new Error("Untrusted upload atomic extension");
  return bindings.get(extension)!.targetSnapshot;
}

export function requireUploadRegistrationSource(extension: PreparedUploadAtomicExtension,
  source: { runId: string; path: string; sha256: string; sizeBytes: number; format: string }): void {
  if (!isPreparedUploadAtomicExtension(extension)) throw new Error("Untrusted upload atomic extension");
  const b = bindings.get(extension)!;
  const item = b.targetSnapshot.ebook_ingest_items.find((row) => row.id === b.job.rawSnapshot.ingest_item_id);
  if (b.purpose !== "effect" || source.runId !== b.command.runId || !item ||
      item.run_id !== source.runId || item.source_path !== source.path || item.state !== "stored" ||
      item.sha256 !== source.sha256 || Number(item.size_bytes) !== source.sizeBytes || item.format !== source.format ||
      Number(b.job.rawSnapshot.source_size_bytes) !== source.sizeBytes ||
      !b.targetSnapshot.ebook_ingest_runs.some((row) => row.id === source.runId && row.kind === "upload" && row.state === "running"))
    throw new Error("Registration differs from the actual stored upload ingest item/job");
}

export function uploadRegistrationIntentOf(extension: PreparedUploadAtomicExtension): unknown {
  if (!isPreparedUploadAtomicExtension(extension)) throw new Error("Untrusted upload atomic extension");
  return (bindings.get(extension)!.job.rawSnapshot.input as Record<string, unknown>).target;
}
