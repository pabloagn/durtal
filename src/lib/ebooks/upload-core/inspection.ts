import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { atomicOn } from "@/lib/db/atomic";
import { assertSql, lockSql, resultRows } from "@/lib/harmonization/store";
import { canonicalJson, prepareIdempotencyRequest } from "../upload/idempotency";
import { readUploadTransport, uploadOwnerPredicate } from "../upload/store";
import { validateInspectorIdentity, type InspectorIdentity } from "../upload/runtime-contract";
import type { SupervisorOwner } from "../upload/supervisor";
import type { UploadPublishedInspection } from "../upload/job-contract";
import { uploadOutcomeSchema, UploadError } from "../upload/protocol";
import { hashBytes } from "../medallion";
import { verifyPublication } from "../publication";
import { uploadCoreHash, newUploadIdentity, readUploadCoreReceipt, type UploadCoreReceipt } from "./receipts";
import { accessSql, requestSql, coreRowProjectionSql, decodeRow, verifyRequest,
  type CoreOperationRow, type CoreScope } from "./store";
import { sourceSeedSql, UPLOAD_CORE_RESULT_MARKER } from "./commands";

export function inspectionLeaseSql(scope:CoreScope,owner:SupervisorOwner,identity:InspectorIdentity):SQL {
  validateInspectorIdentity(identity);
  if (identity.volumeId!==scope.volumeId || identity.bindingSha256!==scope.context.bindingSha256
    || identity.fence.ownerToken!==owner.ownerToken || identity.fence.ownerFence!==owner.ownerFence)
    throw new UploadError(409,"inspection_changed","The upload inspection owner changed.");
  return sql`exists(select 1 from ebook_upload_capacity c join ebook_upload_operations o on o.volume_id=c.volume_id
    where ${uploadOwnerPredicate(owner)} and ${accessSql(scope)} and c.state='ready' and c.worker_state='running'
      and c.worker_operation_id=o.id and c.worker_token=o.lease_token and c.active_part_writers=0
      and c.worker_lease_expires_at>statement_timestamp() and o.lease_expires_at>statement_timestamp()
      and o.id=${identity.fence.operationId}::uuid and o.generation=${identity.fence.generation}
      and o.kind='upload' and o.state='processing' and o.receipt is null and o.reserved_bytes>0
      and o.reservation_released_at is null and coalesce((o.progress #>> '{uploadV1,corrupt}')::boolean,true)=false
      and coalesce(o.progress #> '{uploadV1,writers}','{}'::jsonb)='{}'::jsonb
      and o.progress #>> '{uploadV1,assembled,sha256}'=o.input->>'sha256'
      and (o.progress #>> '{uploadV1,assembled,bytes}')::bigint=o.source_size_bytes
      and exists(select 1 from ebook_upload_operations complete where complete.parent_operation_id=o.id
        and complete.volume_id=o.volume_id and complete.target_fingerprint=o.target_fingerprint
        and complete.binding_sha256=o.binding_sha256 and complete.protocol_version=1 and complete.kind='complete'
        and complete.input->>'action'='complete' and complete.input->>'sha256'=o.input->>'sha256'
        and complete.state='completed' and complete.receipt is not null and complete.receipt_status=200))`;
}
export async function assertInspectionCurrentOn(conn:Db,scope:CoreScope,owner:SupervisorOwner,identity:InspectorIdentity):Promise<void> {
  const rows=resultRows<{current:boolean}>(await conn.execute(sql`select ${inspectionLeaseSql(scope,owner,identity)} as current`));
  if (rows.length!==1 || rows[0].current!==true)
    throw new UploadError(409,"inspection_changed","The upload inspection is no longer current.");
}
export type StoredUploadInspection=Omit<UploadPublishedInspection,"identity"> & {version:1;identity:InspectorIdentity};
export function readStoredInspection(row:CoreOperationRow):StoredUploadInspection {
  const receipt=readUploadCoreReceipt(row.receipt);
  const value=row.progress.inspectionV1;
  canonicalJson(value,96*1024);
  if (!receipt.inspectionSha256 || uploadCoreHash(value)!==receipt.inspectionSha256 || typeof value!=="object" || !value
    || (value as {version?:unknown}).version!==1) throw new Error("Verified publication receipt differs from retained inspection");
  const inspection=value as StoredUploadInspection;
  validateInspectorIdentity(inspection.identity);
  if (inspection.identity.fence.operationId!==row.id || inspection.identity.volumeId!==row.volume_id
    || inspection.identity.bindingSha256!==row.binding_sha256 || inspection.prepared.sha256!==row.input.sha256
    || inspection.prepared.size!==row.source_size_bytes || inspection.name!==row.input.name)
    throw new Error("Retained inspection differs from its permanent source");
  return inspection;
}

/** Real publisher verification precedes the bounded inspection receipt; no
 * catalogue rows exist until a later explicit confirmed canonical plan.
 */
export async function settleInspectionOn(conn:Db,scope:CoreScope,owner:SupervisorOwner,row:CoreOperationRow,
  input:UploadPublishedInspection,current:()=>Promise<void>):Promise<void> {
  const transport=readUploadTransport(row.progress,row.source_size_bytes!);
  if (!transport.assembled || transport.corrupt || input.name!==row.input.name || input.prepared.sha256!==row.input.sha256
    || input.prepared.size!==row.source_size_bytes || input.identity.fence.operationId!==row.id
    || input.identity.fence.generation!==row.generation || hashBytes(input.publication.report)!==input.publication.medallion.silver.sha256
    || canonicalJson(input.metadata.medallion,96*1024)!==canonicalJson(input.publication.medallion,96*1024))
    throw new UploadError(409,"inspection_changed","The publication differs from the verified upload source.");
  const inspection:StoredUploadInspection={version:1,...input};
  // Persist only fully bounded actual evidence, never a truncated metadata DTO.
  canonicalJson(inspection,96*1024);
  await current();
  const problem=await verifyPublication(input.metadata,{current});
  if (problem) throw new UploadError(409,"publication_unverified","Published upload objects could not be verified.");
  await current();
  const request=prepareIdempotencyRequest({key:row.idempotency_key,kind:"upload",protocolVersion:1,
    targetFingerprint:row.target_fingerprint,bindingSha256:row.binding_sha256,parentOperationId:row.parent_operation_id,
    input:JSON.parse(JSON.stringify(row.input))});
  const outcome=uploadOutcomeSchema.parse({operationId:row.id,key:row.idempotency_key,status:200,
    message:"Inspection and publication are verified. Review the catalogue changes before confirming.",preview:null});
  const receipt:UploadCoreReceipt={version:1,request,operationId:row.id,parentOperationId:row.parent_operation_id,
    status:200,result:outcome,effect:null,inspectionSha256:uploadCoreHash(inspection)};
  const progress={...row.progress,inspectionV1:inspection}; canonicalJson(progress,128*1024);
  const activityId=newUploadIdentity(),metadata={extra:{namespace:"durtal.upload.inspection.v1",receipt}};
  const results=await atomicOn(conn,(d)=>[
    d.execute(lockSql(["ebook_upload_capacity","ebook_upload_operations","ebook_ingest_runs","ebook_ingest_items","activity_events"])),
    d.execute(assertSql(sql`${sourceSeedSql(row,scope)} and ${inspectionLeaseSql(scope,owner,input.identity)}`,
      "UPLOAD_CORE_STALE_V1")),
    d.execute(sql`update ebook_upload_operations set progress=${JSON.stringify(progress)}::jsonb,state='ready',
      receipt=${JSON.stringify(receipt)}::jsonb,receipt_status=200,effect_committed_at=statement_timestamp(),
      revision=revision+1,updated_at=statement_timestamp() where id=${row.id}::uuid`),
    d.execute(sql`update ebook_ingest_items set state='stored',format=${input.prepared.format},updated_at=statement_timestamp()
      where id=${row.ingest_item_id}::uuid and run_id=${row.run_id}::uuid and state='pending'
        and sha256=${input.prepared.sha256} and size_bytes=${input.prepared.size}`),
    d.execute(sql`insert into activity_events(id,entity_type,entity_id,event_key,metadata)
      values(${activityId}::uuid,'ebook_upload',${row.id}::uuid,'upload.inspection',${JSON.stringify(metadata)}::jsonb)`),
    d.execute(assertSql(sql`exists(select 1 from ebook_upload_capacity c where ${uploadOwnerPredicate(owner)}
      and c.state='ready' and c.worker_state='running' and c.worker_operation_id=${row.id}::uuid
      and c.worker_token=${row.lease_token}::uuid and c.worker_lease_expires_at>statement_timestamp() and c.active_part_writers=0)
      and exists(select 1 from ebook_upload_operations o where ${accessSql(scope)} and ${requestSql(request)}
      and o.id=${row.id}::uuid and o.input=${JSON.stringify(row.input)}::jsonb and o.progress=${JSON.stringify(progress)}::jsonb
      and o.state='ready' and o.generation=${row.generation} and o.reserved_bytes=${row.reserved_bytes}
      and o.revision=${row.revision+1} and o.receipt=${JSON.stringify(receipt)}::jsonb and o.receipt_status=200
      and o.reservation_released_at is null and o.lease_token=${row.lease_token}::uuid)
      and exists(select 1 from ebook_ingest_items i where i.id=${row.ingest_item_id}::uuid and i.run_id=${row.run_id}::uuid
        and i.source_path=${`upload:${row.id}`} and i.state='stored' and i.format=${input.prepared.format}
        and i.sha256=${input.prepared.sha256} and i.size_bytes=${input.prepared.size} and i.ebook_id is null and i.file_id is null)
      and exists(select 1 from activity_events a where a.id=${activityId}::uuid and a.entity_type='ebook_upload'
        and a.entity_id=${row.id}::uuid and a.event_key='upload.inspection' and a.metadata=${JSON.stringify(metadata)}::jsonb)`,
      "UPLOAD_CORE_RECEIPT_V1")),
    d.execute(sql`select ${coreRowProjectionSql()},${UPLOAD_CORE_RESULT_MARKER}::text as "__uploadCoreResult"
      from ebook_upload_operations o where o.id=${row.id}::uuid`),
  ]);
  const actual=decodeRow(results.at(-1));
  if (!verifyRequest(actual,request,scope)) throw new Error("Inspection has no permanent receipt");
  readStoredInspection(actual);
}
