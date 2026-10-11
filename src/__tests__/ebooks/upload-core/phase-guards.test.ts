import { describe,expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { PgDialect } from "drizzle-orm/pg-core";
import { inspectionLeaseSql } from "@/lib/ebooks/upload-core/inspection";
import { settledUploadSql,uploadReaderHashSql } from "@/lib/ebooks/upload-core/snapshots";
import { sourceSeedSql } from "@/lib/ebooks/upload-core/commands";
import { verifyRequest,type CoreScope } from "@/lib/ebooks/upload-core/store";
import { commandRequest } from "@/lib/ebooks/upload-core/receipts";
import { confirmationIdentity } from "@/lib/ebooks/upload-core/effect-store";
import { registrationRestorationPlanSha256 } from "@/lib/ebooks/ingest/register";
import { coreOperationFixture } from "./operation-fixture";
import { uploadAtomicScenario } from "../upload/atomic-fixture";
import type { UploadEffectPreview } from "@/lib/ebooks/upload-core/plans";
const id="00000000-0000-4000-8000-000000000001",key="00000000-0000-4000-8000-000000000002";
const scope:CoreScope={volumeId:id,databaseFingerprint:"f".repeat(16),context:{channel:"api",targetFingerprint:"a".repeat(64),bindingSha256:"b".repeat(64)}};
const owner={volumeId:id,bindingSha256:scope.context.bindingSha256,ownerToken:key,ownerFence:7,leaseExpiresAt:Date.now()+60_000};
const dialect=new PgDialect();
function heldRestorationFixture(restoration: NonNullable<UploadEffectPreview["restoration"]>,
  coreOperation: UploadEffectPreview["coreOperation"]): UploadEffectPreview {
  const { binding }=uploadAtomicScenario();
  const upload=coreOperationFixture({run_id:id,volume_id:scope.volumeId,target_fingerprint:scope.context.targetFingerprint,
    binding_sha256:scope.context.bindingSha256});
  return {version:1,uploadId:upload.id,bindingSha256:scope.context.bindingSha256,
    targetFingerprint:scope.context.targetFingerprint,prepareCommandId:key,upload,ebookId:restoration.ebookId,
    effect:restoration.kind,registration:null,restoration,matching:null,publication:binding.publication.map((file)=>({...file,ebookId:restoration.ebookId})),coreOperation,
    snapshots:{command:{...binding.command.rawSnapshot,id:key,parent_operation_id:upload.id,run_id:id,volume_id:scope.volumeId,
        target_fingerprint:scope.context.targetFingerprint,binding_sha256:scope.context.bindingSha256},
      job:{...binding.job.rawSnapshot,...upload},capacity:{...binding.owner.capacitySnapshot,volume_id:scope.volumeId,
        binding_sha256:scope.context.bindingSha256},
      target:{...binding.targetSnapshot,ebook_ingest_runs:binding.targetSnapshot.ebook_ingest_runs.map((row)=>({...row,id})),
        ebook_ingest_items:binding.targetSnapshot.ebook_ingest_items.map((row)=>({...row,run_id:id}))},readerSha256:"e".repeat(64),timezone:"UTC",scope:{ebookIds:[restoration.ebookId],runId:id}},
    original:{operationId:key,receipt:binding.receipt,activityId:binding.activityId,coreWriter:"registration",coreOperation,
      catalogueBefore:{ebooks:[],ebook_files:[]},catalogueAfter:{ebooks:[],ebook_files:[]}}};
}
describe("upload publication and user-review phase guards (query construction only)",()=>{
  it("requires the actual running worker, current generation and complete assembled source during publication",()=>{
    const query=dialect.sqlToQuery(inspectionLeaseSql(scope,owner,{volumeId:id,bindingSha256:owner.bindingSha256,
      fence:{operationId:id,ownerToken:key,ownerFence:7,generation:11}}));
    expect(query.sql).toContain("c.worker_state='running'");expect(query.sql).toContain("o.state='processing'");
    expect(query.sql).toContain("c.worker_token=o.lease_token");expect(query.sql).toContain("o.lease_expires_at>statement_timestamp()");
    expect(query.sql).toContain("reservation_released_at is null");expect(query.sql).toContain("input->>'sha256'");
    expect(query.params).toContain(11);expect(query.params).toContain(7);
  });
  it("allows settled review with originals still charged and refuses guessed cleanup or active writers",()=>{
    const query=dialect.sqlToQuery(settledUploadSql(id));
    expect(query.sql).toContain("j.state='ready'");expect(query.sql).toContain("j.cleanup_verified_at is not null");
    expect(query.sql).toContain("j.lease_token is null");expect(query.sql).toContain("c.worker_state='idle'");
    expect(query.sql).toContain("j.reserved_bytes>0");expect(query.sql).toContain("j.reservation_released_at is null");
    expect(query.sql).toContain("c.active_part_writers=0");expect(query.sql).not.toMatch(/update |delete |insert /i);
  });
  it("fingerprints complete scoped reader/retirement/cursor/quote-note rows through canonical timestamp snapshots",()=>{
    const query=dialect.sqlToQuery(uploadReaderHashSql({ebookIds:[id],runId:id}));
    for (const table of ["ebook_positions","ebook_annotations","ebook_annotation_retired_ids","ebook_annotation_cursors","reading_notes"])
      expect(query.sql).toContain(table);
    expect(query.sql).toContain("ebook_annotation_id");expect(query.sql).toContain("sha256");
    expect(query.sql).toContain("at time zone 'UTC'");expect(query.sql).not.toMatch(/update |delete |insert /i);
  });
  it("guards an absent source receipt as SQL NULL and the entire source progress and reservation",()=>{
    const row=coreOperationFixture({id,idempotency_key:key,request_sha256:"c".repeat(64),parent_operation_id:id,run_id:id,ingest_item_id:id,
      input:{name:"book.epub"},progress:{uploadV1:{corrupt:false}},state:"ready",generation:11,reserved_bytes:100,
      source_size_bytes:10,revision:3,receipt:null,receipt_status:null});
    const query=dialect.sqlToQuery(sourceSeedSql(row,scope));
    expect(query.sql).toContain("o.progress=");expect(query.sql).toContain("o.reserved_bytes=");
    expect(query.sql).toContain("o.receipt is not distinct from");expect(query.params).toContain(null);
    expect(query.params).not.toContain("null");
  });
  it("validates pure canonical effect outcomes against immutable command input and identity",()=>{
    const command={action:"confirm" as const,key,previewToken:"c".repeat(64)},request=commandRequest(id,command,scope.context);
    const row=coreOperationFixture({id:key,idempotency_key:key,kind:request.kind,request_sha256:request.requestSha256,
      target_fingerprint:scope.context.targetFingerprint,binding_sha256:scope.context.bindingSha256,protocol_version:1,
      parent_operation_id:id,volume_id:id,input:command,receipt_status:200,
      receipt:{operationId:key,key,status:200,message:"Actual outcome.",preview:null},state:"completed",
      source_size_bytes:null,ingest_item_id:null,reserved_bytes:0});
    expect(verifyRequest(row,request,scope)?.result).toEqual(row.receipt);
    expect(()=>verifyRequest({...row,input:{...command,previewToken:"d".repeat(64)}},request,scope)).toThrow("immutable original request");
    expect(()=>verifyRequest({...row,receipt_status:201},request,scope)).toThrow("identity");
  });
  it("preserves the held native restoration identity independently from any confirmation command",()=>{
    const restoration={version:1 as const,operationId:key,runId:id,targetDatabase:scope.databaseFingerprint,
      planSha256:"0".repeat(64),kind:"compensate_registration" as const,ebookId:id,fileId:null,files:[],preferredAfter:null,coverAfter:null};
    restoration.planSha256=registrationRestorationPlanSha256(restoration);
    const coreOperation={version:1 as const,operationId:key,runId:id,targetDatabase:scope.databaseFingerprint,planSha256:restoration.planSha256};
    const held=heldRestorationFixture(restoration,coreOperation);
    expect(confirmationIdentity(held,scope)).toEqual({restoration,coreOperation});
    expect(confirmationIdentity(held,scope).coreOperation).toBe(coreOperation);
    expect(coreOperation.operationId).not.toBe(id);
  });
  it("refuses a changed held native plan or database rather than regenerating its identity",()=>{
    const restoration={version:1 as const,operationId:key,runId:id,targetDatabase:scope.databaseFingerprint,
      planSha256:"0".repeat(64),kind:"compensate_registration" as const,ebookId:id,fileId:null,files:[],preferredAfter:null,coverAfter:null};
    restoration.planSha256=registrationRestorationPlanSha256(restoration);
    const coreOperation={version:1 as const,operationId:key,runId:id,targetDatabase:scope.databaseFingerprint,planSha256:restoration.planSha256};
    const held=heldRestorationFixture(restoration,coreOperation);
    expect(()=>confirmationIdentity({...held,restoration:{...restoration,preferredAfter:key}},scope)).toThrow("held native");
    expect(()=>confirmationIdentity(held,{...scope,databaseFingerprint:"e".repeat(16)})).toThrow("held native");
  });
});
