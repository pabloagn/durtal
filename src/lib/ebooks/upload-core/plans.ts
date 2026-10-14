import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import type { Db } from "@/lib/catalogue/work-store";
import { resultRows } from "@/lib/harmonization/store";
import { reviewOperationSchema } from "@/lib/validations/ebook-review";
import type { Registration, RegistrationRestorationPlan } from "../ingest/register";
import { planUploadRegistrationOn, planUploadRestoreOn, planUploadUndoOn } from "../ingest/upload-atomic";
import { uploadRegistrationTargetSchema } from "../upload/registration-target";
import { mergeMetadata, type MetadataSource } from "../ingest/metadata";
import type { PlanFile, PlanGroup } from "../ingest/plan";
import type { LoadedMatchCatalogue } from "../match/load";
import type { MatchOperationIdentity, MatchResult } from "../match/types";
import type { UploadAtomicBinding } from "../upload/atomic-extension";
import { UploadError, uploadOutcomeSchema, type UploadCommand } from "../upload/protocol";
import { readStoredInspection } from "./inspection";
import { readCoreOperationOn, type CoreOperationRow, type CoreScope } from "./store";
import { readUploadSnapshotsOn, targetFingerprintFromRows, type UploadSnapshots } from "./snapshots";
import { newUploadIdentity } from "./receipts";

export interface UploadEffectPreview {
  version:1;uploadId:string;bindingSha256:string;targetFingerprint:string;prepareCommandId:string;
  upload:CoreOperationRow; snapshots:UploadSnapshots;ebookId:string;effect:string;
  registration:Registration|null;restoration:RegistrationRestorationPlan|null;
  matching:{snapshot:Pick<LoadedMatchCatalogue,"rows">;result:MatchResult}|null;
  publication:UploadAtomicBinding["publication"];original:UploadAtomicBinding["original"]|null;
  coreOperation:MatchOperationIdentity;
}
const metadataSources:Partial<Record<PlanFile["format"],MetadataSource>>={epub:"epub",kepub:"epub",azw3:"azw3",
  azw:"mobi",mobi:"mobi",fb2:"fb2",fbz:"fb2",pdf:"pdf",cbz:"cbz"};
export function inspectionPlanFile(upload:CoreOperationRow):{group:PlanGroup;file:PlanFile} {
  const inspected=readStoredInspection(upload),p=inspected.prepared,stages=inspected.publication;
  if (!p.validation.downloadable || p.problem || p.drm || !stages.medallion.gold[0])
    throw new UploadError(409,"upload_quarantined","This file is retained for review and cannot be registered as a readable upload.");
  const filename=z.string().parse(upload.input.name),sourcePath=`upload:${upload.id}`;
  const ebook=mergeMetadata([{source:metadataSources[p.format]??"filename",metadata:p.metadata}],filename);
  const file:PlanFile={path:sourcePath,size:p.size,mtimeMs:0,sha256:p.sha256,format:p.format,contentType:p.contentType,
    key:stages.medallion.gold[0].key,medallion:stages.medallion,originalFilename:filename,downloadName:filename,
    drm:p.drm,problem:p.problem,metadata:inspected.metadata,text:p.text,
    derived:p.derived.map((artifact)=>{
      const object=stages.derived.find((object)=>object.name===artifact.name);
      if (!object) throw new Error("Canonical publication derived object missing");
      return {...artifact,key:object.key};
    }),manifestKey:stages.derived.find((o)=>o.name==="manifest.json")?.key??null,
    coverKey:stages.derived.find((o)=>o.name==="cover-800.webp")?.key??null};
  return {file,group:{key:upload.id,folder:`upload:${upload.id}`,sidecar:null,importSource:"upload",importRef:null,
    personalData:false,existingEbookId:null,ebook,paths:[sourcePath]}};
}
export function requireExplicitRegistrationIntent(registration:Registration,target:unknown):void {
  const parsed=z.discriminatedUnion("kind",[z.object({kind:z.literal("new")}),
    z.object({kind:z.literal("add_format"),ebookId:z.uuid()}),z.object({kind:z.literal("replace"),ebookId:z.uuid(),fileId:z.uuid()})]).parse(target);
  if (registration.inserts.length!==1 || registration.items.length!==1 || registration.items[0].outcome==="already_stored"
    || (parsed.kind==="new" ? !registration.newEbook || registration.replaced.length!==0
      : !!registration.newEbook || registration.ebookId!==parsed.ebookId
        || (parsed.kind==="add_format" ? registration.replaced.length!==0
          : registration.replaced.length!==1 || registration.replaced[0].fileId!==parsed.fileId)))
    throw new UploadError(409,"upload_replace_required",registrationIntentRefusal(registration,parsed.kind));
}
/** What the person can do instead, in plain words (SLN-672) */
function registrationIntentRefusal(registration:Registration,kind:"new"|"add_format"|"replace"):string {
  if (registration.items[0]?.outcome==="already_stored") return "This exact file is already in the library.";
  if (kind==="replace") return registration.replaced.length===0
    ? "Replace takes a file of the same format as the one it replaces. To keep this file beside it, use Add a format instead."
    : "The file you chose to replace is no longer the eBook's current one. Go back to the eBook and choose Replace file again.";
  if (kind==="add_format" && registration.replaced.length) return "The eBook already has a file in this format. To change it, use Replace file on that file.";
  return "Review an explicit replacement of the selected current file.";
}
export async function readOriginalRegistrationOn(conn:Db,scope:CoreScope,upload:CoreOperationRow,id:string):Promise<{
  original:NonNullable<UploadAtomicBinding["original"]>;ebookId:string}> {
  const operation=await readCoreOperationOn(conn,scope,{id:z.uuid().parse(id)});
  if (!operation || operation.parent_operation_id!==upload.id || operation.run_id!==upload.run_id || operation.receipt_status!==200)
    throw new UploadError(409,"upload_original_missing","The original committed upload could not be found.");
  const receipt=uploadOutcomeSchema.parse(operation.receipt);
  if (receipt.operationId!==operation.id || receipt.key!==operation.idempotency_key || receipt.status!==200 || receipt.preview!==null)
    throw new Error("Original upload receipt differs from its permanent identity");
  const rows=resultRows<{id:string;entity_id:string;facts:Record<string,unknown>}>(await conn.execute(sql`
    select a.id,a.entity_id,a.metadata #> '{extra,ebookUpload}' as facts from activity_events a
    where a.entity_type='ebook' and a.event_key='ebook.upload.effect.v1'
      and a.metadata #>> '{extra,ebookUpload,operationId}'=${operation.id}`));
  if (rows.length!==1) throw new UploadError(409,"upload_original_missing","The original upload audit could not be verified.");
  const audit=rows[0],facts=audit.facts;
  if (facts.coreWriter!=="registration" || facts.uploadId!==upload.id || facts.operationId!==operation.id)
    throw new Error("Original audit differs from its upload and native writer");
  const coreOperation=reviewOperationSchema.parse(facts.coreOperation);
  if (coreOperation.runId!==upload.run_id
    || coreOperation.targetDatabase!==scope.databaseFingerprint) throw new Error("Original native upload scope differs");
  const catalogue=z.strictObject({ebooks:z.array(z.record(z.string(),z.unknown())),ebook_files:z.array(z.record(z.string(),z.unknown()))});
  return {ebookId:z.uuid().parse(audit.entity_id),original:{operationId:operation.id,receipt:operation.receipt as Record<string,unknown>,
    activityId:z.uuid().parse(audit.id),coreOperation,coreWriter:"registration",
    catalogueBefore:catalogue.parse(facts.catalogueBefore),catalogueAfter:catalogue.parse(facts.catalogueAfter)}};
}
export async function prepareUploadEffectOn(conn:Db,scope:CoreScope,upload:CoreOperationRow,commandRow:CoreOperationRow,
  command:Extract<UploadCommand,{action:"prepare"|"restore"|"undo"}>,now:number):Promise<UploadEffectPreview> {
  const original=command.action==="prepare" ? null:await readOriginalRegistrationOn(conn,scope,upload,command.originalOperationId);
  const selected=command.action==="prepare" ? z.object({kind:z.string(),ebookId:z.uuid().optional()}).parse(upload.input.target).ebookId : original!.ebookId;
  const snapshots=await readUploadSnapshotsOn(conn,scope,upload.id,commandRow.id,selected ? [selected]:[]);
  const base={version:1 as const,uploadId:upload.id,bindingSha256:scope.context.bindingSha256,
    targetFingerprint:scope.context.targetFingerprint,prepareCommandId:commandRow.id,upload,snapshots};
  if (command.action==="prepare") {
    const {file,group}=inspectionPlanFile(upload);
    const native=await planUploadRegistrationOn(conn,{group,file,target:uploadRegistrationTargetSchema.parse(upload.input.target),
      runId:upload.run_id!,at:new Date(now)}),registration=native.registration;
    requireExplicitRegistrationIntent(registration,upload.input.target);
    snapshots.scope={...snapshots.scope,ebookIds:[registration.ebookId]};
    snapshots.target=native.targetSnapshot;
    const inserted=registration.inserts[0];
    if (!inserted.id || !inserted.manifestKey || !inserted.metadata) throw new Error("Canonical registration publication missing");
    return {...base,ebookId:registration.ebookId,registration,restoration:null,original:null,
      matching:native.classification??null,coreOperation:{version:1,operationId:newUploadIdentity(),runId:upload.run_id!,
        targetDatabase:scope.databaseFingerprint,planSha256:native.planSha256},
      effect:registration.newEbook ? "Adds this file to the library as a new eBook."
        : registration.replaced.length ? "Replaces the eBook's file with this one. The old file is kept, and the reading places, highlights and notes stay."
          : "Adds this format to the eBook. Its reading places, highlights and notes stay.",
      publication:[{id:inserted.id,ebookId:registration.ebookId,sha256:inserted.sha256,format:inserted.format,
        sizeBytes:inserted.sizeBytes,s3Key:inserted.s3Key,manifestKey:inserted.manifestKey,metadata:inserted.metadata}]};
  }
  if (command.action==="restore" && targetFingerprintFromRows(snapshots.target,original!.ebookId)!==command.beforeFingerprint)
    throw new UploadError(409,"upload_target_changed","The selected restoration changed. Refresh its review.");
  const operation={version:1 as const,operationId:newUploadIdentity(),runId:upload.run_id!,targetDatabase:scope.databaseFingerprint};
  const native=command.action==="restore" ? await planUploadRestoreOn(conn,{operation,ebookId:original!.ebookId,
    original:original!.original,fileId:command.fileId}) : await planUploadUndoOn(conn,{operation,ebookId:original!.ebookId,original:original!.original});
  const restoration=native.plan;snapshots.target=native.targetSnapshot;
  const file=original!.original.catalogueAfter.ebook_files.find((f)=>command.action==="restore" ? f.id===command.fileId
    : !original!.original.catalogueBefore.ebook_files.some((previous)=>previous.id===f.id));
  if (!file || !file.manifest_key || !file.metadata) throw new UploadError(409,"upload_restore_unavailable","The retained file publication is unavailable.");
  return {...base,ebookId:original!.ebookId,registration:null,restoration,matching:null,original:original!.original,
    coreOperation:{...operation,planSha256:restoration.planSha256},
    effect:command.action==="restore" ? "Restore the retained original file. Keep all passages, reading places and file rows."
      : "Undo this registration by retiring its introduced file. Keep all file rows, passages and reading places.",
    publication:[{id:z.uuid().parse(file.id),ebookId:original!.ebookId,sha256:z.string().parse(file.sha256),format:z.string().parse(file.format),
      sizeBytes:Number(file.size_bytes),s3Key:z.string().parse(file.s3_key),manifestKey:z.string().parse(file.manifest_key),
      metadata:z.record(z.string(),z.unknown()).parse(file.metadata)}]};
}
