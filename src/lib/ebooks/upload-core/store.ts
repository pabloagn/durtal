import { sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import type { Db } from "@/lib/catalogue/work-store";
import { atomicOn } from "@/lib/db/atomic";
import { assertSql, lockSql, resultRows } from "@/lib/harmonization/store";
import { ebookIngestRuns, ebookIngestItems } from "@/lib/db/schema";
import { INGEST_TOOL_VERSION } from "../ingest/plan";
import { canonicalJson, prepareIdempotencyRequest, type PreparedRequest } from "../upload/idempotency";
import { readUploadTransport, uploadOwnerPredicate } from "../upload/store";
import type { SupervisorOwner } from "../upload/supervisor";
import type { UploadCoreContext } from "../upload/core-contract";
import { createUploadBatchSchema, uploadBatchViewSchema, uploadItemViewSchema, uploadOutcomeSchema, uploadCommandSchema, UploadError,
  type CreateUploadBatch, type UploadBatchView, type UploadItemView, type UploadItemSummary,
  type UploadCommand, type UploadOutcome } from "../upload/protocol";
import { batchRequest, childKey, commandRequest, newUploadIdentity, readUploadCoreReceipt,
  type UploadCoreReceipt } from "./receipts";
import { reviewTimestampSql, reviewTimestampIsValidSql } from "../review/store-sql";
import { uploadJobFailureMessage, uploadJobFailureSchema, type UploadJobFailure } from "../upload/job-failure";

export interface CoreOperationRow {
  id: string; idempotency_key: string; kind: string; request_sha256: string; target_fingerprint: string;
  binding_sha256: string; protocol_version: number; parent_operation_id: string | null; volume_id: string;
  run_id: string | null; ingest_item_id: string | null; input: Record<string, unknown>; progress: Record<string, unknown>;
  state: UploadItemView["state"]; generation: number; source_size_bytes: number | null; reserved_bytes: number;
  revision: number; lease_token: string | null; receipt: unknown; receipt_status: number | null;
  __retainedUntil: string | null;
}
export interface CoreScope { volumeId: string; context: UploadCoreContext; databaseFingerprint:string }
const MARKER = "durtal.upload.core.actual.rows.v1";
const stale = "UPLOAD_CORE_STALE_V1", collision = "UPLOAD_CORE_COLLISION_V1", invalid = "UPLOAD_CORE_RECEIPT_V1";
const same = (a: unknown, b: unknown) => canonicalJson(a,128*1024) === canonicalJson(b,128*1024);
export function coreRowProjectionSql(): SQL {
  return sql`o.*,${reviewTimestampSql(sql`o.retention_expires_at`)} as "__retainedUntil",
    (o.retention_expires_at is null or ${reviewTimestampIsValidSql(sql`o.retention_expires_at`)}) as "__timesValid"`;
}
function checkedRow(input: CoreOperationRow & {__timesValid?:boolean}): CoreOperationRow {
  if (input.__timesValid!==true) throw new Error("Upload retention timestamp is unrepresentable");
  const row={...input};
  for (const key of ["protocol_version","generation","reserved_bytes","revision","source_size_bytes"] as const) {
    const value=input[key];
    if (value===null && key==="source_size_bytes") continue;
    if (typeof value!=="number" && (typeof value!=="string" || !/^(0|[1-9][0-9]*)$/.test(value)))
      throw new Error("Upload integer is malformed");
    const number=Number(value);
    if (!Number.isSafeInteger(number) || number<0) throw new Error("Upload integer exceeds its bound");
    row[key]=number;
  }
  canonicalJson(row.input,64*1024); canonicalJson(row.progress,128*1024);
  return row;
}
export function accessSql(scope: CoreScope): SQL {
  z.uuid().parse(scope.volumeId);
  return sql`o.volume_id=${scope.volumeId}::uuid and o.target_fingerprint=${scope.context.targetFingerprint}
    and o.binding_sha256=${scope.context.bindingSha256} and o.protocol_version=1`;
}
export function requestSql(request: PreparedRequest): SQL {
  return sql`o.idempotency_key=${request.key}::uuid and o.kind=${request.kind}
    and o.request_sha256=${request.requestSha256} and o.target_fingerprint=${request.targetFingerprint}
    and o.binding_sha256=${request.bindingSha256} and o.protocol_version=1`;
}
export function ownerReadySql(owner: SupervisorOwner): SQL {
  return sql`exists(select 1 from ebook_upload_capacity c where ${uploadOwnerPredicate(owner)}
    and c.state='ready' and c.reserved_bytes+c.unaccounted_bytes<=c.quota_bytes
    and c.reserved_bytes=c.global_allowance_bytes+coalesce((select sum(x.reserved_bytes)
      from ebook_upload_operations x where x.volume_id=c.volume_id),0))`;
}
function scopeMatches(row: CoreOperationRow, scope: CoreScope) {
  return row.volume_id===scope.volumeId && row.target_fingerprint===scope.context.targetFingerprint &&
    row.binding_sha256===scope.context.bindingSha256 && row.protocol_version===1;
}
export function verifyRequest(row: CoreOperationRow, request: PreparedRequest, scope: CoreScope): UploadCoreReceipt | null {
  if (!scopeMatches(row,scope) || row.idempotency_key!==request.key || row.kind!==request.kind ||
      row.request_sha256!==request.requestSha256)
    throw new UploadError(409,"operation_collision","This upload key belongs to another request.");
  if (row.receipt===null) {
    if (row.receipt_status!==null) throw new Error("Upload receipt status without receipt");
    return null;
  }
  // The canonical495 extension stores the exact506 protocol outcome for a
  // confirmed effect. Its native authority/facts live in the same-commit audit.
  const receipt=(typeof row.receipt==="object" && row.receipt!==null && !Object.hasOwn(row.receipt,"version"))
    ? {version:1 as const,request,operationId:row.id,parentOperationId:row.parent_operation_id,status:row.receipt_status!,
      result:uploadOutcomeSchema.parse(row.receipt),effect:null} : readUploadCoreReceipt(row.receipt);
  if (!("status" in receipt.result) ? request.kind!=="batch" : receipt.result.operationId!==row.id ||
    receipt.result.key!==request.key || receipt.result.status!==row.receipt_status)
    throw new Error("Protocol receipt differs from its permanent identity");
  if (!same(receipt.request,request) || receipt.operationId!==row.id || receipt.parentOperationId!==row.parent_operation_id ||
      receipt.status!==row.receipt_status) throw new Error("Upload receipt differs from durable identity");
  if (request.kind==="batch") {
    const input=createUploadBatchSchema.parse(row.input),result=uploadBatchViewSchema.parse(receipt.result);
    if (!same(batchRequest(input,scope.context),request) || result.id!==row.id || result.runId!==row.run_id
      || result.items.length!==input.files.length || result.items.some((item,index)=>{
        const file=input.files[index];return item.name!==file.name || item.bytes!==file.bytes || item.sha256!==file.sha256 || !same(item.target,file.target);
      })) throw new Error("Creation differs from its immutable source order and identities");
  } else if (request.kind!=="upload" && (!row.parent_operation_id ||
    !same(commandRequest(row.parent_operation_id,uploadCommandSchema.parse(row.input),scope.context),request)))
    throw new Error("Command input differs from its immutable original request");
  return receipt;
}
export async function readCoreOperationOn(conn: Db, scope: CoreScope, input: { id?: string; key?: string }): Promise<CoreOperationRow|null> {
  if ((input.id===undefined)===(input.key===undefined)) throw new Error("Exactly one operation identity required");
  const id=z.uuid().parse(input.id??input.key);
  // Key lookups intentionally include other bindings so collisions cannot be
  // mistaken for an absent key and transformed into a second operation.
  const rows=resultRows<CoreOperationRow>(await conn.execute(sql`select ${coreRowProjectionSql()} from ebook_upload_operations o
    where ${input.key!==undefined ? sql`o.idempotency_key=${id}::uuid` : sql`o.id=${id}::uuid and ${accessSql(scope)}`}`));
  if (rows.length>1) throw new Error("Global upload identity is duplicated");
  return rows[0] ? checkedRow(rows[0]) : null;
}
export function decodeRow(result: unknown): CoreOperationRow {
  const rows=resultRows<CoreOperationRow&{__uploadCoreResult:string}>(result);
  if (rows.length!==1 || rows[0].__uploadCoreResult!==MARKER) throw new Error("Upload atomic terminal row missing");
  return checkedRow(rows[0]);
}
/** Permanent lookup precedes owner readiness, target/currentness and previews.
 * A read-only locked replay rechecks the entire immutable DB receipt row. */
export async function replayCoreReceiptOn(conn: Db, scope: CoreScope, row: CoreOperationRow,
  request: PreparedRequest): Promise<UploadCoreReceipt|null> {
  const receipt=verifyRequest(row,request,scope);
  if (!receipt) return null;
  const results=await atomicOn(conn,(d)=>[
    d.execute(lockSql(["ebook_upload_operations"])),
    d.execute(assertSql(sql`exists(select 1 from ebook_upload_operations o where ${accessSql(scope)}
      and o.id=${row.id}::uuid and ${requestSql(request)} and o.parent_operation_id is not distinct from ${row.parent_operation_id}::uuid
      and o.receipt=${JSON.stringify(row.receipt)}::jsonb and o.receipt_status=${receipt.status})`,collision)),
    d.execute(sql`select ${coreRowProjectionSql()},${MARKER}::text as "__uploadCoreResult" from ebook_upload_operations o where o.id=${row.id}::uuid`),
  ]);
  const actual=verifyRequest(decodeRow(results.at(-1)),request,scope);
  if (!actual) throw new Error("Permanent upload receipt disappeared");
  return actual;
}
export function receiptOutcome(receipt: UploadCoreReceipt): UploadOutcome {
  if (receipt.request.kind==="batch") throw new Error("Creation is not a command receipt");
  return uploadOutcomeSchema.parse(receipt.result);
}
/** Actual run/items and all companion identities commit with the frozen201
 * creation receipt. No catalogue rows or private byte allocations are made. */
export async function createCoreBatchOn(conn: Db, scope: CoreScope, owner: SupervisorOwner,
  input: CreateUploadBatch): Promise<UploadBatchView> {
  const request= batchRequest(input,scope.context), batchId=newUploadIdentity(), runId=newUploadIdentity();
  const prepared=input.files.map((file,index)=>{
    const id=newUploadIdentity(), key=childKey(input.key,index);
    const childInput={...file,uploadCoreV1:{batchId,index,creationKey:input.key}};
    const childRequest=prepareIdempotencyRequest({key,kind:"upload",protocolVersion:1,targetFingerprint:request.targetFingerprint,
      bindingSha256:request.bindingSha256,parentOperationId:batchId,input:JSON.parse(JSON.stringify(childInput))});
    return {id,itemId:newUploadIdentity(),key,file,index,childInput,childRequest};
  });
  const result: UploadBatchView=uploadBatchViewSchema.parse({id:batchId,key:input.key,runId,items:prepared.map(({id,file})=>({
    id,...file,generation:0,state:"queued",acknowledgedBytes:0,retainedUntil:null,message:null,
    ebookId:null,fileId:null,originalOperationId:null,currentFingerprint:null,undoAvailable:false,
  }))});
  const receipt: UploadCoreReceipt={version:1,request,operationId:batchId,parentOperationId:null,status:201,result,effect:null};
  canonicalJson(receipt,128*1024);
  const results=await atomicOn(conn,(d)=>[
    d.execute(lockSql(["ebook_upload_capacity","ebook_upload_operations","ebook_ingest_runs","ebook_ingest_items"])),
    d.execute(assertSql(ownerReadySql(owner),stale)),
    d.execute(assertSql(sql`not exists(select 1 from ebook_upload_operations where idempotency_key=${request.key}::uuid)`,collision)),
    d.insert(ebookIngestRuns).values({id:runId,kind:"upload",state:"running",host:null,roots:[],toolVersion:INGEST_TOOL_VERSION,
      planSha256:request.requestSha256,counts:{}}),
    d.insert(ebookIngestItems).values(prepared.map(({itemId,file,id})=>({id:itemId,runId,sourceHost:null,
      sourcePath:`upload:${id}`,sizeBytes:file.bytes,sha256:file.sha256,state:"pending" as const}))),
    d.execute(sql`insert into ebook_upload_operations(id,idempotency_key,kind,request_sha256,target_fingerprint,
      binding_sha256,protocol_version,volume_id,run_id,input,state,receipt,receipt_status,effect_committed_at)
      values(${batchId}::uuid,${request.key}::uuid,'batch',${request.requestSha256},${request.targetFingerprint},
        ${request.bindingSha256},1,${scope.volumeId}::uuid,${runId}::uuid,${JSON.stringify(input)}::jsonb,
        'completed',${JSON.stringify(receipt)}::jsonb,201,statement_timestamp())`),
    ...prepared.map(({id,itemId,key,file,childInput,childRequest})=>{
      return d.execute(sql`insert into ebook_upload_operations(id,idempotency_key,kind,request_sha256,target_fingerprint,
        binding_sha256,protocol_version,parent_operation_id,volume_id,run_id,ingest_item_id,input,source_size_bytes)
        values(${id}::uuid,${key}::uuid,'upload',${childRequest.requestSha256},${request.targetFingerprint},${request.bindingSha256},1,
          ${batchId}::uuid,${scope.volumeId}::uuid,${runId}::uuid,${itemId}::uuid,${JSON.stringify(childInput)}::jsonb,${file.bytes})`);
    }),
    d.execute(assertSql(sql`${ownerReadySql(owner)} and exists(select 1 from ebook_upload_operations o join ebook_ingest_runs r on r.id=o.run_id
      where o.id=${batchId}::uuid and ${accessSql(scope)} and ${requestSql(request)}
        and o.run_id=${runId}::uuid and r.kind='upload' and r.state='running' and r.host is null
        and r.tool_version=${INGEST_TOOL_VERSION} and r.roots='{}'::text[] and r.counts='{}'::jsonb
        and r.plan_sha256=${request.requestSha256} and o.input=${JSON.stringify(input)}::jsonb
        and o.state='completed' and o.parent_operation_id is null and o.ingest_item_id is null
        and o.source_size_bytes is null and o.reserved_bytes=0 and o.generation=0
        and o.receipt=${JSON.stringify(receipt)}::jsonb and o.receipt_status=201
        and (select count(*) from ebook_upload_operations x where x.parent_operation_id=o.id and x.kind='upload')=${prepared.length}
        and (select count(*) from ebook_ingest_items i where i.run_id=r.id)=${prepared.length})`,invalid)),
    ...prepared.map(({id,itemId,key,file,childInput,childRequest})=>d.execute(assertSql(sql`exists(select 1 from ebook_upload_operations o
      join ebook_ingest_items i on i.id=o.ingest_item_id where o.id=${id}::uuid and ${accessSql(scope)} and o.kind='upload'
        and ${requestSql(childRequest)} and o.parent_operation_id=${batchId}::uuid and o.run_id=${runId}::uuid
        and i.id=${itemId}::uuid and i.run_id=o.run_id and i.source_path=${`upload:${id}`} and i.sha256=${file.sha256}
        and i.size_bytes=${file.bytes} and i.state='pending' and i.source_host is null
        and o.source_size_bytes=${file.bytes} and o.input=${JSON.stringify(childInput)}::jsonb
        and o.progress='{}'::jsonb and o.revision=0 and o.lease_token is null and o.lease_expires_at is null
        and o.state='queued' and o.generation=0 and o.receipt is null and o.receipt_status is null
        and o.reserved_bytes=0 and o.reservation_released_at is null)`,invalid))),
    d.execute(sql`select ${coreRowProjectionSql()},${MARKER}::text as "__uploadCoreResult" from ebook_upload_operations o where o.id=${batchId}::uuid`),
  ]);
  const actual=verifyRequest(decodeRow(results.at(-1)),request,scope);
  if (!actual || actual.status!==201 || !same(actual.result,result)) throw new Error("Creation returned a different immutable view");
  return uploadBatchViewSchema.parse(actual.result);
}
export async function reserveCoreCommandOn(conn: Db, scope: CoreScope, upload: CoreOperationRow,
  command: UploadCommand): Promise<CoreOperationRow> {
  if (!scopeMatches(upload,scope) || upload.kind!=="upload") throw new UploadError(404,"upload_not_found","Upload item not found.");
  const request=commandRequest(upload.id,command,scope.context), id=newUploadIdentity();
  const results=await atomicOn(conn,(d)=>[
    d.execute(lockSql(["ebook_upload_operations"])),
    d.execute(assertSql(sql`exists(select 1 from ebook_upload_operations o where o.id=${upload.id}::uuid
      and ${accessSql(scope)} and o.kind='upload' and o.input=${JSON.stringify(upload.input)}::jsonb)`,stale)),
    d.execute(sql`insert into ebook_upload_operations(id,idempotency_key,kind,request_sha256,target_fingerprint,binding_sha256,
      protocol_version,parent_operation_id,volume_id,run_id,input)
      values(${id}::uuid,${request.key}::uuid,${request.kind},${request.requestSha256},${request.targetFingerprint},
        ${request.bindingSha256},1,${upload.id}::uuid,${scope.volumeId}::uuid,${upload.run_id}::uuid,${JSON.stringify(command)}::jsonb)
      on conflict(idempotency_key) do nothing`),
    d.execute(assertSql(sql`exists(select 1 from ebook_upload_operations o where ${accessSql(scope)} and ${requestSql(request)}
      and o.parent_operation_id=${upload.id}::uuid and o.input=${JSON.stringify(command)}::jsonb)`,collision)),
    d.execute(sql`select ${coreRowProjectionSql()},${MARKER}::text as "__uploadCoreResult" from ebook_upload_operations o where o.idempotency_key=${command.key}::uuid`),
  ]);
  const row=decodeRow(results.at(-1)); verifyRequest(row,request,scope); return row;
}
/** A received file waits for its check (the inspection, whose receipt this row
 * then carries) before it can be previewed, so it shows as being checked rather
 * than ready: Preview, and adding it on its own, wait for the check (SLN-672) */
export function viewedUploadState(row: Pick<CoreOperationRow,"state"|"receipt">): UploadItemView["state"] {
  return row.state==="ready" && row.receipt===null ? "processing" : row.state;
}
/** Why this generation's check failed, as the supervisor recorded it (SLN-1388) */
function recordedJobFailure(row: Pick<CoreOperationRow,"progress"|"generation">): UploadJobFailure|null {
  const recorded=z.object({generation:z.number(),reason:z.unknown(),what:z.unknown()}).safeParse(row.progress.jobFailureV1);
  if (!recorded.success || recorded.data.generation!==Number(row.generation)) return null;
  const failure=uploadJobFailureSchema.safeParse({reason:recorded.data.reason,what:recorded.data.what??null});
  return failure.success ? failure.data : {reason:"check_failed",what:null};
}
export function projectUploadItem(row: CoreOperationRow): UploadItemView {
  if (row.kind!=="upload") throw new Error("Not an upload item");
  const source=createUploadBatchSchema.parse({key:row.idempotency_key,protocol:1,files:[{
    name:row.input.name,bytes:row.input.bytes,sha256:row.input.sha256,target:row.input.target,
  }]}).files[0];
  if (source.bytes!==Number(row.source_size_bytes)) throw new Error("Source envelope differs from item");
  const transport=readUploadTransport(row.progress,source.bytes);
  const facts=z.strictObject({ebookId:z.uuid().nullable(),fileId:z.uuid().nullable(),originalOperationId:z.uuid().nullable(),
    currentFingerprint:z.string().regex(/^[a-f0-9]{64}$/).nullable(),undoAvailable:z.boolean(),
    retainedUntil:z.string().datetime({offset:true}).nullable(),message:z.string().max(900).nullable()})
    .parse(row.progress.coreView??{ebookId:null,fileId:null,originalOperationId:null,currentFingerprint:null,
      undoAvailable:false,retainedUntil:null,message:null});
  const failure=row.state==="failed" && facts.message===null ? recordedJobFailure(row) : null;
  return uploadItemViewSchema.parse({id:row.id,...source,generation:Number(row.generation),state:viewedUploadState(row),
    acknowledged:Object.entries(transport.parts).map(([number,part])=>({number:Number(number),...part})),...facts,
    ...(failure ? {message:uploadJobFailureMessage(failure),refused:failure.reason==="not_an_ebook"} : {}),
    retainedUntil:row.__retainedUntil});
}
export async function readCoreBatchOn(conn: Db, scope: CoreScope, batchId: string): Promise<UploadBatchView|null> {
  const batch=await readCoreOperationOn(conn,scope,{id:batchId});
  if (!batch || batch.kind!=="batch") return null;
  const receipt=verifyRequest(batch,batchRequest(createUploadBatchSchema.parse(batch.input),scope.context),scope);
  if (!receipt) throw new Error("Creation has no permanent receipt");
  const original=uploadBatchViewSchema.parse(receipt.result);
  const rows=resultRows<CoreOperationRow>(await conn.execute(sql`select ${coreRowProjectionSql()} from ebook_upload_operations o
    where ${accessSql(scope)} and o.parent_operation_id=${batch.id}::uuid and o.kind='upload' order by o.id`)).map(checkedRow);
  if (rows.length!==original.items.length) throw new Error("Permanent child identity set changed");
  const items=original.items.map((expected): UploadItemSummary=>{
    const row=rows.find((r)=>r.id===expected.id); if (!row) throw new Error("Upload child missing");
    const {acknowledged,...item}=projectUploadItem(row);
    if (item.name!==expected.name || item.bytes!==expected.bytes || item.sha256!==expected.sha256 || !same(item.target,expected.target))
      throw new Error("Child differs from frozen creation order/source/target");
    return {...item,acknowledgedBytes:acknowledged.reduce((total,part)=>total+part.bytes,0)};
  });
  return uploadBatchViewSchema.parse({...original,items});
}
