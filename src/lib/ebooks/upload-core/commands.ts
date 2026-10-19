import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { atomicOn } from "@/lib/db/atomic";
import { assertSql, lockSql } from "@/lib/harmonization/store";
import { canonicalJson } from "../upload/idempotency";
import { readUploadTransport } from "../upload/store";
import type { SupervisorOwner } from "../upload/supervisor";
import { UploadError, uploadOutcomeSchema, type UploadCommand, type UploadOutcome, type UploadItemView } from "../upload/protocol";
import { commandRequest, newUploadIdentity, type UploadCoreReceipt } from "./receipts";
import { settleUploadRunSql } from "./run-settle";
import { accessSql, requestSql, ownerReadySql, coreRowProjectionSql, decodeRow, verifyRequest,
  receiptOutcome, type CoreOperationRow, type CoreScope } from "./store";

export const UPLOAD_CORE_RESULT_MARKER="durtal.upload.core.actual.rows.v1";
export function sourceSeedSql(row: CoreOperationRow, scope: CoreScope): SQL {
  return sql`exists(select 1 from ebook_upload_operations o where ${accessSql(scope)} and o.id=${row.id}::uuid
    and o.kind='upload' and o.idempotency_key=${row.idempotency_key}::uuid and o.request_sha256=${row.request_sha256}
    and o.parent_operation_id=${row.parent_operation_id}::uuid and o.run_id=${row.run_id}::uuid
    and o.ingest_item_id=${row.ingest_item_id}::uuid and o.input=${JSON.stringify(row.input)}::jsonb
    and o.progress=${JSON.stringify(row.progress)}::jsonb and o.state=${row.state} and o.generation=${row.generation}
    and o.reserved_bytes=${row.reserved_bytes} and o.source_size_bytes=${row.source_size_bytes}
    and o.revision=${row.revision} and o.receipt is not distinct from ${row.receipt===null ? null : JSON.stringify(row.receipt)}::jsonb
    and o.receipt_status is not distinct from ${row.receipt_status} and o.reservation_released_at is null)`;
}
export function commandSeedSql(row: CoreOperationRow, scope: CoreScope): SQL {
  const request=commandRequest(row.parent_operation_id!,row.input as UploadCommand,scope.context);
  return sql`exists(select 1 from ebook_upload_operations o where ${accessSql(scope)} and ${requestSql(request)}
    and o.id=${row.id}::uuid and o.parent_operation_id=${row.parent_operation_id}::uuid
    and o.input=${JSON.stringify(row.input)}::jsonb and o.progress=${JSON.stringify(row.progress)}::jsonb
    and o.run_id=${row.run_id}::uuid
    and o.ingest_item_id is null and o.source_size_bytes is null and o.reserved_bytes=0
    and o.state='queued' and o.receipt is null and o.receipt_status is null and o.effect_committed_at is null)`;
}

/** These are transport/control receipts, never catalogue success. Reservations,
 * worker leases, source files and cleanup proof remain owned by the supervisor.
 */
export async function commitTransportCommandOn(conn: Db, scope: CoreScope, owner: SupervisorOwner,
  upload: CoreOperationRow, commandRow: CoreOperationRow, command: UploadCommand): Promise<UploadOutcome> {
  const transport=readUploadTransport(upload.progress,upload.source_size_bytes!);
  let state: UploadItemView["state"]=upload.state, generation=upload.generation, status=200, message:string;
  let progress=upload.progress;
  let extraGuard:SQL=sql`true`;
  switch(command.action) {
    case "admit":
      if (command.generation!==generation || !["admitted","receiving"].includes(state) || upload.reserved_bytes<=0)
        throw new UploadError(409,"upload_not_receiving","Refresh this upload before sending more bytes.");
      message="Upload space is reserved and ready to receive bytes."; break;
    case "complete":
      if (command.generation!==generation || !["admitted","receiving","ready"].includes(state)
        || upload.receipt!==null || upload.reserved_bytes<=0 || transport.corrupt || !transport.assembled
        || transport.assembled.bytes!==upload.source_size_bytes || transport.assembled.sha256!==command.sha256
        || command.sha256!==upload.input.sha256 || Object.keys(transport.writers).length)
        throw new UploadError(409,"upload_incomplete","The complete source must be verified before inspection.");
      state="ready"; message="The verified upload is queued for inspection and publication.";
      extraGuard=sql`exists(select 1 from ebook_upload_capacity c where c.volume_id=${owner.volumeId}::uuid and c.active_part_writers=0)`;
      break;
    case "cancel":
      if (["completed","expired"].includes(state)) throw new UploadError(409,"upload_finished","This upload already finished.");
      // Keep generation/lease until actual exit so cleanup can still prove this
      // exact job. The caller cancels its process only after this receipt commits.
      status=state==="processing" || state==="quiescing" ? 202 : 200;
      extraGuard=sql`not exists(select 1 from ebook_upload_operations effect where effect.parent_operation_id=${upload.id}::uuid
        and effect.input->>'action'='confirm' and effect.state='completed' and effect.receipt_status=200
        and effect.effect_committed_at is not null)`;
      state="canceled"; message="Upload canceled."; break;
    case "retry":
      if (state!=="failed" || upload.receipt!==null || transport.corrupt || upload.reserved_bytes<=0)
        throw new UploadError(409,"upload_retry_unavailable","Recover this upload before retrying it.");
      extraGuard=sql`exists(select 1 from ebook_upload_capacity c join ebook_upload_operations o on o.volume_id=c.volume_id
        where o.id=${upload.id}::uuid and c.worker_state='idle' and c.worker_operation_id is null
          and c.active_part_writers=0 and o.lease_token is null and o.lease_expires_at is null
          and o.cleanup_verified_at is not null and coalesce(o.progress #> '{uploadV1,writers}','{}'::jsonb)='{}'::jsonb)`;
      generation+=1; state=transport.assembled ? "ready" : "receiving";
      // A new check starts: the last one's failure no longer describes the file (SLN-1466)
      progress=Object.fromEntries(Object.entries(upload.progress).filter(([key])=>key!=="jobFailureV1"));
      message="The settled upload is ready to retry using its retained bytes."; break;
    default: throw new Error("Preview and confirmation require the canonical upload writer");
  }
  const request=commandRequest(upload.id,command,scope.context);
  const outcome=uploadOutcomeSchema.parse({operationId:commandRow.id,key:command.key,status,message,preview:null});
  const receipt:UploadCoreReceipt={version:1,request,operationId:commandRow.id,parentOperationId:upload.id,status,result:outcome,effect:null};
  canonicalJson(receipt,128*1024);
  const activityId=newUploadIdentity(), metadata={extra:{namespace:"durtal.upload.command.v1",receipt}};
  const results=await atomicOn(conn,(d)=>[
    d.execute(lockSql(["ebook_upload_capacity","ebook_upload_operations","ebook_ingest_runs","activity_events"])),
    d.execute(assertSql(sql`${ownerReadySql(owner)} and ${sourceSeedSql(upload,scope)}
      and ${commandSeedSql(commandRow,scope)} and ${extraGuard}`,"UPLOAD_CORE_STALE_V1")),
    d.execute(sql`update ebook_upload_operations set state=${state},generation=${generation},progress=${JSON.stringify(progress)}::jsonb,
      revision=revision+1,updated_at=statement_timestamp() where id=${upload.id}::uuid`),
    d.execute(sql`update ebook_upload_operations set state='completed',receipt=${JSON.stringify(receipt)}::jsonb,
      receipt_status=${status},effect_committed_at=statement_timestamp(),revision=revision+1,updated_at=statement_timestamp()
      where id=${commandRow.id}::uuid`),
    d.execute(sql`insert into activity_events(id,entity_type,entity_id,event_key,metadata)
      values(${activityId}::uuid,'ebook_upload',${upload.id}::uuid,'upload.command',${JSON.stringify(metadata)}::jsonb)`),
    // Canceling the last open file settles its run (SLN-1395)
    ...(state==="canceled" ? [d.execute(settleUploadRunSql(upload.run_id!))] : []),
    d.execute(assertSql(sql`${ownerReadySql(owner)} and exists(select 1 from ebook_upload_operations o where ${accessSql(scope)}
      and o.id=${upload.id}::uuid and o.input=${JSON.stringify(upload.input)}::jsonb
      and o.progress=${JSON.stringify(progress)}::jsonb and o.state=${state} and o.generation=${generation}
      and o.revision=${upload.revision+1} and o.reserved_bytes=${upload.reserved_bytes}
      and o.receipt is not distinct from ${upload.receipt===null ? null : JSON.stringify(upload.receipt)}::jsonb
      and o.receipt_status is not distinct from ${upload.receipt_status} and o.reservation_released_at is null)
      and exists(select 1 from ebook_upload_operations o where ${accessSql(scope)} and ${requestSql(request)}
        and o.id=${commandRow.id}::uuid and o.parent_operation_id=${upload.id}::uuid
        and o.receipt=${JSON.stringify(receipt)}::jsonb and o.receipt_status=${status} and o.state='completed')
      and exists(select 1 from activity_events a where a.id=${activityId}::uuid and a.entity_type='ebook_upload'
        and a.entity_id=${upload.id}::uuid and a.event_key='upload.command' and a.metadata=${JSON.stringify(metadata)}::jsonb)`,
      "UPLOAD_CORE_RECEIPT_V1")),
    d.execute(sql`select ${coreRowProjectionSql()},${UPLOAD_CORE_RESULT_MARKER}::text as "__uploadCoreResult"
      from ebook_upload_operations o where o.id=${commandRow.id}::uuid`),
  ]);
  const actual=verifyRequest(decodeRow(results.at(-1)),request,scope);
  if (!actual) throw new Error("Command has no actual permanent receipt");
  return receiptOutcome(actual);
}
