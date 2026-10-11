import { beforeEach,describe,expect,it,vi } from "vitest";
import type { Db } from "@/lib/catalogue/work-store";
import type { CoreOperationRow } from "@/lib/ebooks/upload-core/store";
import { stageFile, validationFor } from "@/lib/ebooks/medallion";
import type { UploadPublishedInspection } from "@/lib/ebooks/upload/job-contract";
import { coreOperationFixture } from "./operation-fixture";
import { UploadSupervisor } from "@/lib/ebooks/upload/supervisor";
const mocks=vi.hoisted(()=>({read:vi.fn(),replay:vi.fn(),create:vi.fn(),reserve:vi.fn(),transport:vi.fn(),
  prepare:vi.fn(),confirm:vi.fn(),bind:vi.fn(),assert:vi.fn(),settle:vi.fn(),stored:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/ebooks/upload-core/store",async(original)=>({...await original<typeof import("@/lib/ebooks/upload-core/store")>(),
  readCoreOperationOn:mocks.read,replayCoreReceiptOn:mocks.replay,createCoreBatchOn:mocks.create,reserveCoreCommandOn:mocks.reserve}));
vi.mock("@/lib/ebooks/upload-core/commands",async(original)=>({...await original<typeof import("@/lib/ebooks/upload-core/commands")>(),
  commitTransportCommandOn:mocks.transport}));
vi.mock("@/lib/ebooks/upload-core/plans",async(original)=>({...await original<typeof import("@/lib/ebooks/upload-core/plans")>(),
  prepareUploadEffectOn:mocks.prepare}));
vi.mock("@/lib/ebooks/upload-core/effect-store",async(original)=>({...await original<typeof import("@/lib/ebooks/upload-core/effect-store")>(),
  confirmUploadEffectOn:mocks.confirm,bindConfirmationPreviewOn:mocks.bind}));
vi.mock("@/lib/ebooks/upload-core/inspection",async(original)=>({...await original<typeof import("@/lib/ebooks/upload-core/inspection")>(),
  assertInspectionCurrentOn:mocks.assert,settleInspectionOn:mocks.settle,readStoredInspection:mocks.stored}));
import { ActualUploadCoreAdapter } from "@/lib/ebooks/upload-core/service";
import { uploadTargetFingerprint,commandRequest,batchRequest } from "@/lib/ebooks/upload-core/receipts";
const uploadId="00000000-0000-4000-8000-000000000001",key="00000000-0000-4000-8000-000000000002";
const operationId="00000000-0000-4000-8000-000000000003",volumeId="00000000-0000-4000-8000-000000000004";
const url="postgresql://fixture@localhost/upload_core_test",bindingSha256="a".repeat(64);
const context={channel:"api" as const,bindingSha256,targetFingerprint:uploadTargetFingerprint(url)};
const input={key,protocol:1 as const,files:[{name:"book.epub",bytes:10,sha256:"b".repeat(64),target:{kind:"new" as const}}]};
const upload=coreOperationFixture({id:uploadId,kind:"upload",run_id:operationId,volume_id:volumeId,
  binding_sha256:bindingSha256,target_fingerprint:context.targetFingerprint,receipt:null,input:input.files[0],generation:1});
const row=coreOperationFixture({id:operationId,parent_operation_id:uploadId,run_id:operationId,volume_id:volumeId,
  binding_sha256:bindingSha256,target_fingerprint:context.targetFingerprint,kind:"complete",input:{action:"confirm",key,previewToken:"c".repeat(64)},state:"queued",source_size_bytes:null,
  ingest_item_id:null,reserved_bytes:0,receipt:null});
function publishedInspectionFixture(identity: UploadPublishedInspection["identity"]): UploadPublishedInspection {
  const prepared: UploadPublishedInspection["prepared"]={version:2,sha256:"b".repeat(64),size:10,format:"epub",
    contentType:"application/epub+zip",validation:validationFor("epub",null,null,true),drm:null,problem:null,
    metadata:{title:"Nadja"},details:{},text:{wordCount:null,charCount:null,frontBackWordCount:null,pageEstimate:null,
      language:null,toolVersion:1,reason:"Fixture does not extract text."},coverReason:"Fixture has no cover.",derived:[],opfUuid:null};
  const metadata={notes:"Original"};
  return {identity,name:"book.epub",prepared,metadata,
    publication:stageFile(prepared,metadata,Buffer.from(JSON.stringify({version:1,format:prepared.format,sha256:prepared.sha256})))};
}
const adapter=()=>new ActualUploadCoreAdapter({database:{} as Db,planningUrl:url,volumeId,bindingSha256});
function bindReady(core:ActualUploadCoreAdapter) {
  const supervisor=Object.assign(Object.create(UploadSupervisor.prototype),{readiness:()=>({state:"ready",owner:{volumeId,
    bindingSha256,ownerToken:key,ownerFence:1,leaseExpiresAt:Date.now()+60_000}}),cancelJob:vi.fn()}) as UploadSupervisor;
  core.bindSupervisor(supervisor);return supervisor;
}
describe("actual upload adapter original replay and job handoff (module mocks, no database)",()=>{
  beforeEach(()=>vi.resetAllMocks());
  it("returns the original creation view before supervisor readiness",async()=>{
    const original={id:operationId,key,runId:operationId,items:[]};mocks.read.mockResolvedValue(row);
    mocks.replay.mockResolvedValue({version:1,request:batchRequest(input,context),operationId,parentOperationId:null,status:201,result:original,effect:null});
    expect(await adapter().createBatch(input,context)).toEqual(original);expect(mocks.create).not.toHaveBeenCalled();
  });
  it("looks up creation once after a lost acknowledgement and never issues another create",async()=>{
    const core=adapter();bindReady(core);const original={id:operationId,key,runId:operationId,items:[]};
    mocks.read.mockResolvedValueOnce(null).mockResolvedValueOnce(row);mocks.create.mockRejectedValue(new Error("response lost"));
    mocks.replay.mockResolvedValue({version:1,request:batchRequest(input,context),operationId,parentOperationId:null,status:201,result:original,effect:null});
    expect(await core.createBatch(input,context)).toEqual(original);expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("checks source access before a global receipt lookup",async()=>{
    mocks.read.mockResolvedValue(null);
    await expect(adapter().replayCommand(uploadId,{action:"undo",key,originalOperationId:operationId},context))
      .rejects.toMatchObject({status:404});
    expect(mocks.read).toHaveBeenCalledTimes(1);expect(mocks.read.mock.calls[0][2]).toEqual({id:uploadId});
    expect(mocks.replay).not.toHaveBeenCalled();expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it("replays a committed confirmation before cache loss, owner failure or target changes",async()=>{
    const command={action:"confirm" as const,key,previewToken:"c".repeat(64)},result={operationId,key,status:200,message:"Original registered outcome.",preview:null};
    mocks.read.mockResolvedValueOnce(upload).mockResolvedValueOnce(row);
    mocks.replay.mockResolvedValue({version:1,request:commandRequest(uploadId,command,context),operationId,parentOperationId:uploadId,status:200,result,effect:null});
    expect(await adapter().command(uploadId,command,context)).toEqual(result);
    expect(mocks.confirm).not.toHaveBeenCalled();expect(mocks.prepare).not.toHaveBeenCalled();expect(mocks.bind).not.toHaveBeenCalled();
  });
  it("durably reserves an absent key before returning null for broker allocation",async()=>{
    mocks.read.mockResolvedValueOnce(upload).mockResolvedValueOnce(null).mockResolvedValueOnce(upload);
    mocks.reserve.mockResolvedValue(row);mocks.replay.mockResolvedValue(null);
    expect(await adapter().replayCommand(uploadId,{action:"complete",key,generation:1,sha256:"b".repeat(64)},context)).toBeNull();
    expect(mocks.reserve).toHaveBeenCalledTimes(1);expect(mocks.transport).not.toHaveBeenCalled();
  });
  it("does not cancel the process before a durable canceled receipt",async()=>{
    const core=adapter(),supervisor=bindReady(core),command={action:"cancel" as const,key};
    mocks.read.mockResolvedValueOnce(upload).mockResolvedValueOnce(null).mockResolvedValueOnce(upload)
      .mockResolvedValueOnce(upload).mockResolvedValueOnce(row);
    mocks.reserve.mockResolvedValue(row);mocks.replay.mockResolvedValue(null);
    mocks.transport.mockImplementation(async()=>{expect(supervisor.cancelJob).not.toHaveBeenCalled();return {operationId,key,status:202,message:"Canceled; bytes retained.",preview:null};});
    expect((await core.command(uploadId,command,context)).status).toBe(202);
    expect(supervisor.cancelJob).toHaveBeenCalledTimes(1);expect(supervisor.cancelJob).toHaveBeenCalledWith(uploadId);
  });
  it("propagates job receipt failure unless a matching original inspection actually committed",async()=>{
    const core=adapter();bindReady(core);const identity={volumeId,bindingSha256,fence:{operationId:uploadId,ownerToken:key,ownerFence:1,generation:1}};
    const published=publishedInspectionFixture(identity);
    mocks.read.mockResolvedValue(upload);mocks.settle.mockRejectedValue(new Error("atomic suffix failed"));
    await expect(core.settleInspection(published,context)).rejects.toThrow("atomic suffix failed");
    expect(mocks.settle).toHaveBeenCalledTimes(1);expect(mocks.stored).not.toHaveBeenCalled();
  });
  it("captures published inspection and worker identity before the first delayed source read",async()=>{
    const core=adapter();bindReady(core);
    const identity={volumeId,bindingSha256,fence:{operationId:uploadId,ownerToken:key,ownerFence:1,generation:1}};
    const published=publishedInspectionFixture(identity),originalReport=published.publication.report;
    let release!:(value:CoreOperationRow)=>void;
    mocks.read.mockReturnValueOnce(new Promise<CoreOperationRow>((resolve)=>{release=resolve;}));
    mocks.settle.mockResolvedValue(undefined);
    const pending=core.settleInspection(published,context);
    identity.fence.generation=2;published.prepared.sha256="c".repeat(64);
    published.metadata.notes="Mutated";published.publication.report="Mutated report";
    expect(mocks.settle).not.toHaveBeenCalled();release(upload);await pending;
    const captured=mocks.settle.mock.calls[0][4];
    expect(captured).toMatchObject({identity:{fence:{generation:1}},prepared:{sha256:"b".repeat(64)},
      metadata:{notes:"Original"},publication:{report:originalReport}});
    expect(Object.isFrozen(captured.identity.fence)).toBe(true);
  });
  it("captures constructor configuration while retaining the actual database handle",async()=>{
    const database={} as Db,config={database,planningUrl:url,volumeId,bindingSha256};
    const core=new ActualUploadCoreAdapter(config);bindReady(core);
    config.database={} as Db;config.planningUrl="Mutated";config.volumeId=operationId;config.bindingSha256="d".repeat(64);
    const original={id:operationId,key,runId:operationId,items:[]};
    mocks.read.mockResolvedValue(row);
    mocks.replay.mockResolvedValue({version:1,request:batchRequest(input,context),operationId,parentOperationId:null,status:201,result:original,effect:null});
    expect(await core.createBatch(input,context)).toEqual(original);
    expect(mocks.read.mock.calls[0][0]).toBe(database);
    expect(mocks.read.mock.calls[0][1]).toMatchObject({volumeId,context});
  });
  it("captures original batch intent before a delayed permanent lookup",async()=>{
    const core=adapter(),submitted={...input,files:input.files.map((file)=>({...file,target:{...file.target}}))};
    let release!:(value:CoreOperationRow)=>void;
    mocks.read.mockReturnValueOnce(new Promise<CoreOperationRow>((resolve)=>{release=resolve;}));
    const original={id:operationId,key,runId:operationId,items:[]};
    mocks.replay.mockResolvedValue({version:1,request:batchRequest(input,context),operationId,parentOperationId:null,status:201,result:original,effect:null});
    const pending=core.createBatch(submitted,context);
    submitted.files[0].name="mutated.epub";submitted.files[0].sha256="c".repeat(64);
    release(row);expect(await pending).toEqual(original);
    expect(mocks.replay.mock.calls[0][3]).toEqual(batchRequest(input,context));
  });
});
