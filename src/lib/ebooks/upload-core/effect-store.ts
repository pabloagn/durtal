import { sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { Db } from "@/lib/catalogue/work-store";
import { atomicOn } from "@/lib/db/atomic";
import { textArraySql } from "@/lib/db/sql-arrays";
import { assertSql, lockSql, resultRows } from "@/lib/harmonization/store";
import { dataFingerprint } from "../match/load";
import { prepareUploadAtomicExtension, type UploadAtomicBinding } from "../upload/atomic-extension";
import { registrationPlanSha256,registrationRestorationPlanSha256 } from "../ingest/register";
import { applyUploadMutationOn } from "../ingest/upload-atomic";
import { canonicalJson } from "../upload/idempotency";
import { uploadTableSnapshotSql, uploadRowSnapshotSql, UPLOAD_TARGET_TABLES } from "../upload/atomic-snapshots";
import type { SupervisorOwner } from "../upload/supervisor";
import { uploadOutcomeSchema, UploadError, type UploadCommand, type UploadOutcome } from "../upload/protocol";
import { commandRequest, newUploadIdentity, type UploadCoreReceipt } from "./receipts";
import { sourceSeedSql, commandSeedSql, UPLOAD_CORE_RESULT_MARKER } from "./commands";
import { accessSql, ownerReadySql, requestSql, coreRowProjectionSql, decodeRow, verifyRequest, receiptOutcome,
  type CoreScope, type CoreOperationRow } from "./store";
import { uploadReaderHashSql, UPLOAD_READER_TABLES, settledUploadSql, type UploadSnapshots } from "./snapshots";
import type { UploadEffectPreview } from "./plans";
import { settleUploadRunSql } from "./run-settle";

export function previewProgress(plan:UploadEffectPreview):Record<string,unknown> {
  return {...plan.upload.progress,uploadCoreV1:{publication:plan.publication,preparationId:plan.prepareCommandId,
    planSha256:plan.registration ? registrationPlanSha256(plan.registration,plan.matching??undefined):plan.restoration!.planSha256}};
}
export function confirmationIdentity(plan:UploadEffectPreview,scope:CoreScope) {
  const expected=plan.restoration ? registrationRestorationPlanSha256(plan.restoration)
    : registrationPlanSha256(plan.registration!,plan.matching??undefined);
  if (plan.coreOperation.planSha256!==expected || plan.coreOperation.runId!==plan.upload.run_id
    || plan.coreOperation.targetDatabase!==scope.databaseFingerprint)
    throw new UploadError(409,"upload_preview_changed","The held native upload plan changed. Prepare a fresh review.");
  // Native identity was issued during preparation. The independent permanent
  // confirmation command must not silently rehash or replace that identity.
  return {restoration:plan.restoration,coreOperation:plan.coreOperation};
}
export async function bindConfirmationPreviewOn(conn:Db,scope:CoreScope,owner:SupervisorOwner,plan:UploadEffectPreview,
  upload:CoreOperationRow,commandRow:CoreOperationRow,token:string,expiresAt:string):Promise<CoreOperationRow> {
  const coreOperation=confirmationIdentity(plan,scope).coreOperation;
  const progress={uploadCoreV1:{previewTokenSha256:createHash("sha256").update(token).digest("hex"),
    expiresAt:expiresAt.replace(/\.(\d{3})Z$/,(_m,fraction:string)=>`.${fraction}000Z`),coreOperation,publication:plan.publication}};
  canonicalJson(progress,128*1024);
  if (Object.keys(commandRow.progress).length) {
    if (dataFingerprint(commandRow.progress)!==dataFingerprint(progress))
      throw new UploadError(409,"upload_preview_changed","This confirmation key already holds a different preview.");
    return commandRow;
  }
  const results=await atomicOn(conn,(d)=>[
    d.execute(lockSql(["ebook_upload_capacity","ebook_upload_operations",...Object.keys(plan.snapshots.target)])),
    d.execute(assertSql(sql`${ownerReadySql(owner)} and ${sourceSeedSql(upload,scope)} and ${commandSeedSql(commandRow,scope)}
      and ${settledUploadSql(upload.id)} and ${targetGuardSql(plan.snapshots)}`,"UPLOAD_CORE_STALE_V1")),
    d.execute(sql`update ebook_upload_operations set progress=${JSON.stringify(progress)}::jsonb,revision=revision+1,
      updated_at=statement_timestamp() where id=${commandRow.id}::uuid`),
    d.execute(assertSql(sql`${ownerReadySql(owner)} and ${sourceSeedSql(upload,scope)} and ${targetGuardSql(plan.snapshots)}
      and exists(select 1 from ebook_upload_operations o where ${accessSql(scope)} and o.id=${commandRow.id}::uuid
        and o.input=${JSON.stringify(commandRow.input)}::jsonb and o.progress=${JSON.stringify(progress)}::jsonb
        and o.state='queued' and o.receipt is null and o.receipt_status is null
        and o.parent_operation_id=${upload.id}::uuid and o.run_id=${upload.run_id}::uuid
        and o.request_sha256=${commandRow.request_sha256} and o.idempotency_key=${commandRow.idempotency_key}::uuid
        and o.revision=${commandRow.revision+1})`,"UPLOAD_CORE_RECEIPT_V1")),
    d.execute(sql`select ${coreRowProjectionSql()},${UPLOAD_CORE_RESULT_MARKER}::text as "__uploadCoreResult"
      from ebook_upload_operations o where o.id=${commandRow.id}::uuid`),
  ]);
  return decodeRow(results.at(-1));
}
function targetGuardSql(snapshots:UploadSnapshots):SQL {
  return sql`${sql.join(UPLOAD_TARGET_TABLES.map((table)=>sql`
    ${uploadTableSnapshotSql(table,snapshots.scope)}=${JSON.stringify(snapshots.target[table])}::jsonb`),sql` and `)}
    and ${uploadReaderHashSql(snapshots.scope)}=${snapshots.readerSha256}`;
}
/** Persist the preparation's original outcome and exact publication/plan
 * identity. This is a preview only; catalogue mutations remain inside the core.
 */
export async function commitUploadPreviewOn(conn:Db,scope:CoreScope,owner:SupervisorOwner,plan:UploadEffectPreview,
  commandRow:CoreOperationRow,command:UploadCommand,preview:{token:string;expiresAt:string}):Promise<UploadOutcome> {
  const request=commandRequest(plan.uploadId,command,scope.context),progress=previewProgress(plan);
  canonicalJson(progress,128*1024);
  const outcome=uploadOutcomeSchema.parse({operationId:commandRow.id,key:command.key,status:200,message:"Upload changes are ready to review.",
    preview:{...preview,effect:plan.effect}});
  const receipt:UploadCoreReceipt={version:1,request,operationId:commandRow.id,parentOperationId:plan.uploadId,status:200,result:outcome,effect:null};
  const results=await atomicOn(conn,(d)=>[
    d.execute(lockSql(["ebook_upload_capacity","ebook_upload_operations",...Object.keys(plan.snapshots.target),...UPLOAD_READER_TABLES])),
    d.execute(assertSql(sql`${ownerReadySql(owner)} and ${sourceSeedSql(plan.upload,scope)}
      and ${commandSeedSql(commandRow,scope)} and ${settledUploadSql(plan.uploadId)} and ${targetGuardSql(plan.snapshots)}`,
      "UPLOAD_CORE_STALE_V1")),
    d.execute(sql`update ebook_upload_operations set progress=${JSON.stringify(progress)}::jsonb,revision=revision+1,
      updated_at=statement_timestamp() where id=${plan.uploadId}::uuid`),
    d.execute(sql`update ebook_upload_operations set state='completed',receipt=${JSON.stringify(receipt)}::jsonb,receipt_status=200,
      effect_committed_at=statement_timestamp(),revision=revision+1,updated_at=statement_timestamp() where id=${commandRow.id}::uuid`),
    d.execute(assertSql(sql`${ownerReadySql(owner)} and ${settledUploadSql(plan.uploadId)} and ${targetGuardSql(plan.snapshots)}
      and exists(select 1 from ebook_upload_operations o where ${accessSql(scope)} and o.id=${plan.uploadId}::uuid
        and o.input=${JSON.stringify(plan.upload.input)}::jsonb and o.progress=${JSON.stringify(progress)}::jsonb
        and o.generation=${plan.upload.generation} and o.revision=${plan.upload.revision+1}
        and o.reserved_bytes=${plan.upload.reserved_bytes} and o.receipt=${JSON.stringify(plan.upload.receipt)}::jsonb)
      and exists(select 1 from ebook_upload_operations o where ${accessSql(scope)} and ${requestSql(request)}
        and o.id=${commandRow.id}::uuid and o.parent_operation_id=${plan.uploadId}::uuid
        and o.receipt=${JSON.stringify(receipt)}::jsonb and o.receipt_status=200 and o.state='completed')`,"UPLOAD_CORE_RECEIPT_V1")),
    d.execute(sql`select ${coreRowProjectionSql()},${UPLOAD_CORE_RESULT_MARKER}::text as "__uploadCoreResult"
      from ebook_upload_operations o where o.id=${commandRow.id}::uuid`),
  ]);
  const actual=verifyRequest(decodeRow(results.at(-1)),request,scope);
  if (!actual) throw new Error("Preview receipt is missing");return receiptOutcome(actual);
}
function actualCatalogueSql(snapshots:UploadSnapshots):SQL {
  return sql`jsonb_build_object('ebooks',${uploadTableSnapshotSql("ebooks",snapshots.scope)},
    'ebook_files',${uploadTableSnapshotSql("ebook_files",snapshots.scope)})`;
}
function finalRegistrationSql(plan:UploadEffectPreview):SQL {
  const r=plan.registration;
  if (!r) return sql`true`;
  const f=r.inserts[0];
  const fields={id:f.id,ebook_id:r.ebookId,sha256:f.sha256,format:f.format,size_bytes:f.sizeBytes,
    content_type:f.contentType,original_filename:f.originalFilename??null,s3_key:f.s3Key,status:f.status,
    verified_at:null,drm:f.drm??null,source_host:f.sourceHost??null,source_path:f.sourcePath??null,
    metadata:f.metadata??{},word_count:f.wordCount??null,char_count:f.charCount??null,
    front_back_word_count:f.frontBackWordCount??null,page_estimate:f.pageEstimate??null,
    text_language:f.textLanguage??null,text_tool_version:f.textToolVersion??null,manifest_key:f.manifestKey??null,cover_key:f.coverKey??null};
  return sql`exists(select 1 from ebook_files f where f.id=${f.id}::uuid
    and (to_jsonb(f)-'created_at'-'updated_at'-'source_mtime')=${JSON.stringify(fields)}::jsonb
    and f.created_at=${r.at.toISOString()}::timestamptz and f.updated_at=${r.at.toISOString()}::timestamptz
    and f.source_mtime=${new Date(0).toISOString()}::timestamptz)
    and exists(select 1 from ebooks e where e.id=${r.ebookId}::uuid and e.preferred_file_id is not distinct from ${r.preferredAfter}::uuid
      and e.cover_key is not distinct from ${r.coverAfter})
    and exists(select 1 from ebook_ingest_items i where i.id=${plan.upload.ingest_item_id}::uuid
      and i.run_id=${plan.upload.run_id}::uuid and i.source_path=${r.items[0].path} and i.state='registered'
      and i.outcome=${r.items[0].outcome} and i.ebook_id=${r.ebookId}::uuid and i.file_id=${f.id}::uuid
      and i.sha256=${f.sha256} and i.size_bytes=${f.sizeBytes})`;
}
function finalCatalogueEffectSql(plan:UploadEffectPreview):SQL {
  const r=plan.registration,restoration=plan.restoration;
  const fileChanges=new Map(r ? r.replaced.map((f)=>[f.fileId,"replaced"])
    : restoration!.files.map((f)=>[f.fileId,f.status]));
  const fileGuards=plan.snapshots.target.ebook_files.map((before)=>{
    const status=fileChanges.get(String(before.id));
    return sql`exists(select 1 from ebook_files f where f.id=${String(before.id)}::uuid and
      ${status ? sql`(${uploadRowSnapshotSql("ebook_files","f")}-'status'-'updated_at')=
        (${JSON.stringify(before)}::jsonb-'status'-'updated_at') and f.status=${status}
        and f.updated_at>${String(before.updated_at)}::timestamptz`
        : sql`${uploadRowSnapshotSql("ebook_files","f")}=${JSON.stringify(before)}::jsonb`})`;
  });
  const beforeBook=plan.snapshots.target.ebooks.find((e)=>e.id===plan.ebookId);
  const changes=["updated_at","preferred_file_id","cover_key",...(plan.matching
    ? ["match_tier","match_fingerprint","match_model_version","duplicate_of_id"]:[])];
  let bookGuard:SQL;
  if (beforeBook) bookGuard=sql`(${uploadRowSnapshotSql("ebooks","e")}-${textArraySql(changes)})=
    (${JSON.stringify(beforeBook)}::jsonb-${textArraySql(changes)}) and e.updated_at>${String(beforeBook.updated_at)}::timestamptz`;
  else {
    const n=r!.newEbook!;
    const expected={id:plan.ebookId,title:n.title,title_sort:n.titleSort??null,subtitle:n.subtitle??null,authors:n.authors??[],
      author_sort:n.authorSort??null,language:n.language??null,isbns:n.isbns??[],identifiers:n.identifiers??{},series:n.series??null,
      series_index:n.seriesIndex??null,publisher:n.publisher??null,published_year:n.publishedYear??null,description:n.description??null,
      instance_id:null,match_state:"pending",match_method:null,match_probability:null,matched_at:null,
      link_written:null,exclusion_reason:null,import_source:n.importSource,import_ref:n.importRef??null,search_text:n.searchText??""};
    bookGuard=sql`(to_jsonb(e)-${textArraySql([...changes,"created_at","match_tier","match_fingerprint","match_model_version","duplicate_of_id"])})
      =${JSON.stringify(expected)}::jsonb and e.created_at=${r!.at.toISOString()}::timestamptz`;
  }
  const match=plan.matching?.result;
  const candidateGuards=match ? match.candidates.map((candidate)=>{
    const reasons=[...candidate.reasons,...candidate.effect.ambiguities,...(candidate.effect.movedFromEditionId
      ? [{code:"move_copy",text:candidate.effect.text}]:[])];
    return sql`exists(select 1 from ebook_match_candidates c where c.ebook_id=${plan.ebookId}::uuid and c.rank=${candidate.rank}
      and c.work_id=${candidate.workId}::uuid and c.edition_id is not distinct from ${candidate.effect.editionId}::uuid
      and c.instance_id is not distinct from ${candidate.effect.movedFromEditionId ? null:candidate.effect.instanceId}::uuid
      and c.edition_rule=${candidate.effect.rule} and c.probability=${candidate.probability}::real
      and c.weight_bits=${candidate.weightBits}::real and c.margin_bits is not distinct from ${candidate.marginBits}::real
      and c.reasons=${JSON.stringify(reasons)}::jsonb and c.flags=${textArraySql([...candidate.flags])}
      and c.model_version=${match.modelVersion} and c.created_at=${r!.at.toISOString()}::timestamptz)`;
  }):[];
  return sql`${finalRegistrationSql(plan)} and
    (select count(*) from ebook_files f where f.ebook_id=${plan.ebookId}::uuid)=
      ${plan.snapshots.target.ebook_files.length+(r ? r.inserts.length:0)}
    and exists(select 1 from ebooks e where e.id=${plan.ebookId}::uuid and ${bookGuard}
      and e.preferred_file_id is not distinct from ${r?.preferredAfter??restoration?.preferredAfter??null}::uuid
      and e.cover_key is not distinct from ${r?.coverAfter??restoration?.coverAfter??null}
      and ${match ? sql`e.match_state='pending' and e.instance_id is null and e.match_fingerprint=${match.fingerprint}
        and e.match_tier is not distinct from ${match.tier} and e.match_model_version=${match.modelVersion}
        and e.duplicate_of_id is not distinct from ${match.duplicateOfId}::uuid`:sql`true`})
    and ${sql.join(fileGuards.length ? fileGuards:[sql`true`],sql` and `)}
    and ${match ? sql`(select count(*) from ebook_match_candidates c where c.ebook_id=${plan.ebookId}::uuid)=${match.candidates.length}`:sql`true`}
    and ${sql.join(candidateGuards.length ? candidateGuards:[sql`true`],sql` and `)}`;
}

/** This function imports and calls the actual canonical issuer/writers. It
 * supplies only server-built queries for source/reader guards and actual final
 * receipt capture. It has no direct catalogue/annotation mutation branch.
 */
export async function confirmUploadEffectOn(conn:Db,scope:CoreScope,owner:SupervisorOwner,plan:UploadEffectPreview,
  currentUpload:CoreOperationRow,commandRow:CoreOperationRow,snapshots:UploadSnapshots,expiresAt:string):Promise<UploadOutcome> {
  if (plan.uploadId!==currentUpload.id || plan.bindingSha256!==scope.context.bindingSha256
    || plan.targetFingerprint!==scope.context.targetFingerprint || plan.upload.generation!==currentUpload.generation
    || dataFingerprint(currentUpload.progress)!==dataFingerprint(previewProgress(plan))
    || dataFingerprint(currentUpload.input)!==dataFingerprint(plan.upload.input))
    throw new UploadError(409,"upload_preview_changed","Prepare a fresh upload review before confirming.");
  const request=commandRequest(currentUpload.id,commandRow.input as UploadCommand,scope.context);
  const {restoration,coreOperation}=confirmationIdentity(plan,scope);
  const coreWriter=restoration?.kind??"registration",purpose=coreWriter==="compensate_registration" ? "compensation"
    : coreWriter==="restore_registration" ? "restore":"effect";
  const outcome={...uploadOutcomeSchema.parse({operationId:commandRow.id,key:commandRow.idempotency_key,status:200,
    message:coreWriter==="registration" ? "Upload registered. The original files and reader data are retained."
      : coreWriter==="restore_registration" ? "Retained file restored. Reader data is preserved."
        : "Upload registration undone. File rows and reader data are preserved.",preview:null}),status:200 as const,preview:null};
  const activityId=newUploadIdentity();
  const binding:UploadAtomicBinding={version:1,purpose,databaseFingerprint:scope.databaseFingerprint,
    previewTokenSha256:(snapshots.command.progress as {uploadCoreV1:{previewTokenSha256:string}}).uploadCoreV1.previewTokenSha256,
    expiresAt:expiresAt.replace(/\.(\d{3})Z$/,(_match,fraction:string)=>`.${fraction}000Z`),
    coreWriter,coreOperation,ebookIds:[plan.ebookId],command:{id:commandRow.id,key:commandRow.idempotency_key,
      requestSha256:request.requestSha256,targetFingerprint:scope.context.targetFingerprint,bindingSha256:scope.context.bindingSha256,
      volumeId:scope.volumeId,runId:currentUpload.run_id!,rawSnapshot:snapshots.command},
    owner:{token:owner.ownerToken,fence:owner.ownerFence,capacitySnapshot:snapshots.capacity},
    job:{id:currentUpload.id,generation:currentUpload.generation,mode:"settled",leaseToken:null,rawSnapshot:snapshots.job},
    targetSnapshot:plan.snapshots.target,publication:plan.publication,receipt:outcome,activityId,
    ...(plan.original ? {original:plan.original}:{})};
  const event=purpose==="effect" ? "ebook.upload.effect.v1" : purpose==="restore" ? "ebook.upload.restore.v1":"ebook.upload.compensation.v1";
  const beforeCatalogue={ebooks:plan.snapshots.target.ebooks,ebook_files:plan.snapshots.target.ebook_files};
  const facts={operationId:commandRow.id,uploadId:currentUpload.id,coreWriter,coreOperation,catalogueBefore:beforeCatalogue,
    registeredFileId:plan.registration?.inserts[0].id??restoration?.fileId??null,
    originalOperationId:plan.original?.operationId??null,readerSha256:plan.snapshots.readerSha256};
  const extension=prepareUploadAtomicExtension(binding,{
    before:(d)=>[
      d.execute(assertSql(sql`${ownerReadySql(owner)} and ${settledUploadSql(currentUpload.id)}
        and ${sourceSeedSql(currentUpload,scope)} and ${commandSeedSql(commandRow,scope)}
        and ${targetGuardSql(plan.snapshots)}`,"UPLOAD_CORE_STALE_V1")),
    ],
    after:(d)=>[
      d.execute(assertSql(sql`${finalCatalogueEffectSql(plan)}
        and ${uploadReaderHashSql(plan.snapshots.scope)}=${plan.snapshots.readerSha256}`,"UPLOAD_CORE_RECEIPT_V1")),
      d.execute(sql`update ebook_upload_operations set receipt=${JSON.stringify(outcome)}::jsonb,receipt_status=200,
        effect_committed_at=clock_timestamp(),state='completed',revision=revision+1,updated_at=clock_timestamp()
        where id=${commandRow.id}::uuid`),
      // Adding the last open file settles its run (SLN-1395)
      d.execute(settleUploadRunSql(currentUpload.run_id!)),
      d.execute(sql`insert into activity_events(id,entity_type,entity_id,event_key,metadata)
        values(${activityId}::uuid,'ebook',${plan.ebookId}::uuid,${event},jsonb_build_object('extra',
          jsonb_build_object('ebookUpload',${JSON.stringify(facts)}::jsonb || jsonb_build_object('catalogueAfter',${actualCatalogueSql(plan.snapshots)}))))`),
      d.execute(assertSql(sql`${ownerReadySql(owner)} and ${sourceSeedSql(currentUpload,scope)} and ${finalCatalogueEffectSql(plan)}
        and ${uploadReaderHashSql(plan.snapshots.scope)}=${plan.snapshots.readerSha256}
        and exists(select 1 from ebook_upload_operations o where ${accessSql(scope)} and ${requestSql(request)}
          and o.id=${commandRow.id}::uuid and o.input=${JSON.stringify(commandRow.input)}::jsonb
          and o.parent_operation_id=${currentUpload.id}::uuid and o.receipt=${JSON.stringify(outcome)}::jsonb
          and o.receipt_status=200 and o.state='completed')
        and exists(select 1 from activity_events a where a.id=${activityId}::uuid and a.entity_type='ebook'
          and a.entity_id=${plan.ebookId}::uuid and a.event_key=${event}
          and a.metadata=jsonb_build_object('extra',jsonb_build_object('ebookUpload',${JSON.stringify(facts)}::jsonb
            || jsonb_build_object('catalogueAfter',${actualCatalogueSql(plan.snapshots)}))))`,"UPLOAD_CORE_RECEIPT_V1")),
    ],
  });
  const results=await applyUploadMutationOn(conn,plan.registration
    ? {kind:"registration",registration:plan.registration,operation:coreOperation,target:scope.databaseFingerprint,
      ...(plan.matching ? {classification:plan.matching}:{})}
    : {kind:restoration!.kind,plan:restoration!,target:scope.databaseFingerprint},{uploadExtension:extension});
  const rows=resultRows<{marker:string;receipt:unknown;status:number;activity:unknown}>(results.at(-1));
  if (rows.length!==1 || rows[0].marker!=="durtal.ebook.upload.rows.v1" || rows[0].status!==200
    || dataFingerprint(rows[0].receipt)!==dataFingerprint(outcome)) throw new Error("Canonical upload writer did not return its actual final receipt");
  return uploadOutcomeSchema.parse(rows[0].receipt);
}
