import "server-only";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import type { Db } from "@/lib/catalogue/work-store";
import { resultRows } from "@/lib/harmonization/store";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { dataFingerprint } from "../match/load";
import { immutableMatchingWriterInput } from "../match/link";
import { databaseFingerprint } from "../ingest/command";
import { UploadSupervisor, type SupervisorOwner } from "../upload/supervisor";
import type { UploadJobCoreAdapter, UploadPublishedInspection } from "../upload/job-contract";
import type { UploadCoreContext } from "../upload/core-contract";
import { validateInspectorIdentity, type InspectorIdentity } from "../upload/runtime-contract";
import { createUploadBatchSchema, uploadCommandSchema, uploadBatchViewSchema, uploadItemViewSchema,
  uploadOutcomeSchema, UploadError, type UploadCommand, type CreateUploadBatch, type UploadOutcome,
  type UploadBatchView, type UploadItemView } from "../upload/protocol";
import { batchRequest, commandRequest, uploadTargetFingerprint } from "./receipts";
import { createCoreBatchOn, readCoreOperationOn, replayCoreReceiptOn, receiptOutcome, reserveCoreCommandOn,
  readCoreBatchOn, projectUploadItem, type CoreScope, type CoreOperationRow } from "./store";
import { commitTransportCommandOn } from "./commands";
import { assertInspectionCurrentOn, settleInspectionOn, readStoredInspection } from "./inspection";
import { readUploadSnapshotsOn, targetFingerprintFromRows, settledUploadSql } from "./snapshots";
import { readUploadTargetSnapshotOn } from "../upload/atomic-snapshots";
import { prepareUploadEffectOn, type UploadEffectPreview } from "./plans";
import { UploadPreviewCache } from "./preview-cache";
import { commitUploadPreviewOn, confirmUploadEffectOn, bindConfirmationPreviewOn } from "./effect-store";

/** Explicit owned-service composition only. The constructor starts no worker,
 * listener, connection, background timer or cloud work. The real supervisor is
 * bound once by506 composition; all effect calls go to canonical494/495 source.
 */
export class ActualUploadCoreAdapter implements UploadJobCoreAdapter {
  private supervisor:UploadSupervisor|null=null;
  private readonly previews:UploadPreviewCache<UploadEffectPreview>;
  readonly targetFingerprint:string;
  private readonly input:{database:Db;planningUrl:string;volumeId:string;bindingSha256:string;now?:()=>number};
  constructor(input:{database:Db;planningUrl:string;volumeId:string;bindingSha256:string;now?:()=>number}) {
    // Retain service handles, but own the configuration values before any call.
    this.input=Object.freeze({...input});
    z.uuid().parse(this.input.volumeId);z.string().regex(/^[a-f0-9]{64}$/).parse(this.input.bindingSha256);
    this.targetFingerprint=uploadTargetFingerprint(this.input.planningUrl);
    this.previews=new UploadPreviewCache(this.input.now);
  }
  /**506 calls this with the same actual supervisor it passes to broker/dispatcher. */
  bindSupervisor(supervisor:UploadSupervisor):void {
    if (!(supervisor instanceof UploadSupervisor) || this.supervisor) throw new Error("Actual upload supervisor must be bound exactly once");
    this.supervisor=supervisor;
  }
  private scope(context:UploadCoreContext):CoreScope {
    const parsed=z.strictObject({channel:z.enum(["ui","api"]),targetFingerprint:z.string().regex(/^[a-f0-9]{64}$/),
      bindingSha256:z.string().regex(/^[a-f0-9]{64}$/)}).parse(context);
    if (parsed.targetFingerprint!==this.targetFingerprint || parsed.bindingSha256!==this.input.bindingSha256)
      throw new UploadError(404,"upload_not_found","Upload binding not found.");
    return immutableMatchingWriterInput({volumeId:this.input.volumeId,context:parsed,databaseFingerprint:databaseFingerprint(this.input.planningUrl)});
  }
  private owner():SupervisorOwner {
    const ready=this.supervisor?.readiness();
    if (!ready || ready.state!=="ready" || ready.owner.volumeId!==this.input.volumeId || ready.owner.bindingSha256!==this.input.bindingSha256)
      throw new UploadError(503,"upload_unavailable","Uploads are waiting for the owned worker to recover.");
    return immutableMatchingWriterInput(ready.owner);
  }
  private now():number {
    const now=(this.input.now??Date.now)();
    if (!Number.isSafeInteger(now)) throw new Error("Invalid upload core clock");return now;
  }
  private read<T>(run:(conn:Db)=>Promise<T>):Promise<T> {
    return withReadOnlyPlanningConnection(this.input.planningUrl,run,{isolationLevel:"repeatable read"});
  }
  private async uploadOn(conn:Db,scope:CoreScope,id:string):Promise<CoreOperationRow> {
    const upload=await readCoreOperationOn(conn,scope,{id:z.uuid().parse(id)});
    if (!upload || upload.kind!=="upload") throw new UploadError(404,"upload_not_found","Upload item not found.");return upload;
  }
  async createBatch(input:CreateUploadBatch,context:UploadCoreContext):Promise<UploadBatchView> {
    const scope=this.scope(context),parsed=immutableMatchingWriterInput(createUploadBatchSchema.parse(input)),request=batchRequest(parsed,scope.context);
    const existing=await readCoreOperationOn(this.input.database,scope,{key:parsed.key});
    if (existing) {
      const receipt=await replayCoreReceiptOn(this.input.database,scope,existing,request);
      if (!receipt || receipt.request.kind!=="batch") throw new Error("Permanent creation receipt missing");
      return uploadBatchViewSchema.parse(receipt.result);
    }
    try {return await createCoreBatchOn(this.input.database,scope,this.owner(),parsed);}
    catch(error) {
      // One receipt lookup after a concurrent commit/lost acknowledgement. An
      // uncertain response never issues a second atomic creation attempt.
      const committed=await readCoreOperationOn(this.input.database,scope,{key:parsed.key});
      if (committed) {
        const receipt=await replayCoreReceiptOn(this.input.database,scope,committed,request);
        if (receipt) return uploadBatchViewSchema.parse(receipt.result);
      }
      throw error;
    }
  }
  private async liveItemOn(conn:Db,scope:CoreScope,upload:CoreOperationRow):Promise<UploadItemView> {
    const view=projectUploadItem(upload);
    const rows=resultRows<{receipt:unknown;id:string;ebookId:string;facts:Record<string,unknown>;event:string}>(await conn.execute(sql`
      select o.receipt,o.id,a.entity_id as "ebookId",a.metadata #> '{extra,ebookUpload}' as facts,a.event_key as event
      from ebook_upload_operations o join activity_events a on a.metadata #>> '{extra,ebookUpload,operationId}'=o.id::text
      where o.parent_operation_id=${upload.id}::uuid and o.volume_id=${scope.volumeId}::uuid
        and o.target_fingerprint=${scope.context.targetFingerprint} and o.binding_sha256=${scope.context.bindingSha256}
        and o.protocol_version=1 and o.input->>'action'='confirm' and o.state='completed' and o.receipt_status=200
        and o.effect_committed_at is not null and a.entity_type='ebook'
        and a.event_key in ('ebook.upload.effect.v1','ebook.upload.restore.v1','ebook.upload.compensation.v1')
        and a.metadata #>> '{extra,ebookUpload,uploadId}'=${upload.id}
      order by o.effect_committed_at desc,o.id desc limit 1`));
    if (!rows.length) return view;
    const effect=rows[0],receipt=uploadOutcomeSchema.parse(effect.receipt);
    if (receipt.operationId!==effect.id || receipt.status!==200 || receipt.preview!==null) throw new Error("Upload effect view has invalid receipt");
    const bookRows=await readUploadTargetSnapshotOn(conn,{ebookIds:[effect.ebookId],runId:upload.run_id!});
    const book=bookRows.ebooks.find((e)=>e.id===effect.ebookId);
    if (!book) throw new Error("Retained upload e-book disappeared");
    return uploadItemViewSchema.parse({...view,state:"completed",ebookId:effect.ebookId,
      fileId:effect.facts.registeredFileId??book.preferred_file_id??null,originalOperationId:effect.event==="ebook.upload.effect.v1" ? effect.id
        : effect.facts.originalOperationId??null,currentFingerprint:targetFingerprintFromRows(bookRows,effect.ebookId),
      undoAvailable:effect.event==="ebook.upload.effect.v1" && dataFingerprint(effect.facts.catalogueAfter)===
        dataFingerprint({ebooks:bookRows.ebooks,ebook_files:bookRows.ebook_files}),message:receipt.message});
  }
  async readBatch(batchId:string,context:UploadCoreContext):Promise<UploadBatchView|null> {
    const scope=this.scope(context);z.uuid().parse(batchId);
    return this.read(async(conn)=>{
      const batch=await readCoreBatchOn(conn,scope,batchId);if (!batch) return null;
      const items=await Promise.all(batch.items.map(async(summary)=>{
        const upload=await this.uploadOn(conn,scope,summary.id),{acknowledged,...item}=await this.liveItemOn(conn,scope,upload);
        return {...item,acknowledgedBytes:acknowledged.reduce((total,p)=>total+p.bytes,0)};
      }));
      return uploadBatchViewSchema.parse({...batch,items});
    });
  }
  async readItem(operationId:string,context:UploadCoreContext):Promise<UploadItemView|null> {
    const scope=this.scope(context);z.uuid().parse(operationId);
    return this.read(async(conn)=>{
      const upload=await readCoreOperationOn(conn,scope,{id:operationId});
      return !upload || upload.kind!=="upload" ? null:this.liveItemOn(conn,scope,upload);
    });
  }
  async replayCommand(operationId:string,input:UploadCommand,context:UploadCoreContext):Promise<UploadOutcome|null> {
    const scope=this.scope(context),command=immutableMatchingWriterInput(uploadCommandSchema.parse(input));
    // Access first, then global-key replay, then reserve. No freshness, worker
    // readiness, preview lookup, target rows or byte allocation precedes replay.
    await this.uploadOn(this.input.database,scope,operationId);
    const request=commandRequest(operationId,command,scope.context);
    const existing=await readCoreOperationOn(this.input.database,scope,{key:command.key});
    if (existing) {
      const receipt=await replayCoreReceiptOn(this.input.database,scope,existing,request);
      if (receipt) return receiptOutcome(receipt);
    }
    const upload=await this.uploadOn(this.input.database,scope,operationId);
    const reserved=await reserveCoreCommandOn(this.input.database,scope,upload,command);
    const receipt=await replayCoreReceiptOn(this.input.database,scope,reserved,request);
    return receipt ? receiptOutcome(receipt):null;
  }
  async command(operationId:string,input:UploadCommand,context:UploadCoreContext):Promise<UploadOutcome> {
    const scope=this.scope(context),command=immutableMatchingWriterInput(uploadCommandSchema.parse(input));
    const replay=await this.replayCommand(operationId,command,scope.context);if (replay) return replay;
    const owner=this.owner(),upload=await this.uploadOn(this.input.database,scope,operationId);
    const commandRow=await readCoreOperationOn(this.input.database,scope,{key:command.key});
    if (!commandRow) throw new Error("Upload command was not durably reserved");
    try {
      let outcome:UploadOutcome;
      if (command.action==="admit" || command.action==="complete" || command.action==="cancel" || command.action==="retry") {
        outcome=await commitTransportCommandOn(this.input.database,scope,owner,upload,commandRow,command);
        if (command.action==="cancel") this.supervisor!.cancelJob(upload.id);
      } else if (command.action==="confirm") {
        const plan=this.previews.get(command.previewToken),expiresAt=this.previews.expiresAt(command.previewToken);
        if (!plan || !expiresAt) throw new UploadError(409,"upload_preview_expired","Prepare a fresh review before confirming this upload.");
        const bound=await bindConfirmationPreviewOn(this.input.database,scope,owner,plan,upload,commandRow,command.previewToken,expiresAt);
        const snapshots=await this.read((conn)=>readUploadSnapshotsOn(conn,scope,upload.id,bound.id,[plan.ebookId]));
        outcome=await confirmUploadEffectOn(this.input.database,scope,owner,plan,upload,bound,snapshots,expiresAt);
        this.previews.delete(command.previewToken);
      } else {
        readStoredInspection(upload);
        const plan=await this.read(async(conn)=>{
          const ready=resultRows<{ready:boolean}>(await conn.execute(sql`select ${settledUploadSql(upload.id)} as ready`));
          if (ready.length!==1 || ready[0].ready!==true) throw new UploadError(409,"upload_not_settled","Wait for the upload worker to finish verified cleanup.");
          return prepareUploadEffectOn(conn,scope,upload,commandRow,command,this.now());
        });
        const preview=this.previews.put(plan);
        try {outcome=await commitUploadPreviewOn(this.input.database,scope,owner,plan,commandRow,command,preview);}
        catch(error) {
          // Keep a committed preview after acknowledgement loss; clear only an
          // uncommitted entry. The outer permanent lookup performs no rewrite.
          const row=await readCoreOperationOn(this.input.database,scope,{key:command.key});
          if (!row?.receipt) this.previews.delete(preview.token);throw error;
        }
      }
      return outcome;
    } catch(error) {
      const committed=await readCoreOperationOn(this.input.database,scope,{key:command.key});
      if (committed) {
        const receipt=await replayCoreReceiptOn(this.input.database,scope,committed,commandRequest(upload.id,command,scope.context));
        if (receipt) {
          if (command.action==="cancel") this.supervisor!.cancelJob(upload.id);
          if (command.action==="confirm") this.previews.delete(command.previewToken);
          return receiptOutcome(receipt);
        }
      }
      throw error;
    }
  }
  async assertInspectionCurrent(identity:InspectorIdentity,context:UploadCoreContext):Promise<void> {
    identity=immutableMatchingWriterInput(identity);
    const scope=this.scope(context);validateInspectorIdentity(identity);
    await assertInspectionCurrentOn(this.input.database,scope,this.owner(),identity);
  }
  async settleInspection(input:UploadPublishedInspection,context:UploadCoreContext):Promise<void> {
    input=immutableMatchingWriterInput(input);
    const scope=this.scope(context);validateInspectorIdentity(input.identity);
    const upload=await this.uploadOn(this.input.database,scope,input.identity.fence.operationId);
    if (upload.receipt!==null) {
      if (dataFingerprint(readStoredInspection(upload))!==dataFingerprint({version:1,...input}))
        throw new UploadError(409,"inspection_changed","The inspection differs from its original receipt.");
      return;
    }
    const owner=this.owner();
    try {await settleInspectionOn(this.input.database,scope,owner,upload,input,()=>this.assertInspectionCurrent(input.identity,scope.context));}
    catch(error) {
      const actual=await this.uploadOn(this.input.database,scope,upload.id);
      if (actual.receipt!==null && dataFingerprint(readStoredInspection(actual))===dataFingerprint({version:1,...input})) return;
      throw error;
    }
  }
}
