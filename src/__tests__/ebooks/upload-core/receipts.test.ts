import { describe,expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { batchRequest,commandRequest,childKey,readUploadCoreReceipt,uploadTargetFingerprint,uploadCoreHash } from "@/lib/ebooks/upload-core/receipts";
import { databaseFingerprint } from "@/lib/ebooks/ingest/command";
import { UploadPreviewCache } from "@/lib/ebooks/upload-core/preview-cache";
import { requireExplicitRegistrationIntent } from "@/lib/ebooks/upload-core/plans";
import type { Registration } from "@/lib/ebooks/ingest/register";

const id="00000000-0000-4000-8000-000000000001",other="00000000-0000-4000-8000-000000000002";
const context={channel:"ui" as const,targetFingerprint:"a".repeat(64),bindingSha256:"b".repeat(64)};
describe("actual upload permanent identity and held plans (no database)",()=>{
  it("binds source order, explicit target, bytes and binding while preserving cross-channel replay",()=>{
    const input={key:id,protocol:1 as const,files:[{name:"book.epub",bytes:42,sha256:"c".repeat(64),target:{kind:"new" as const}}]};
    const request=batchRequest(input,context);
    expect(batchRequest(input,{...context,channel:"api"})).toEqual(request);
    expect(batchRequest({...input,files:[{...input.files[0],bytes:43}]},context)).not.toEqual(request);
    expect(batchRequest(input,{...context,bindingSha256:"d".repeat(64)})).not.toEqual(request);
    const prepared=commandRequest(other,{action:"prepare",key:id},context),complete=commandRequest(other,{action:"complete",key:id,generation:0,sha256:"c".repeat(64)},context);
    expect(prepared.kind).toBe("complete");expect(prepared.requestSha256).not.toBe(complete.requestSha256);
    expect(commandRequest(id,{action:"prepare",key:id},context)).not.toEqual(prepared);
    expect(childKey(id,0)).not.toBe(childKey(id,1));expect(childKey(id,0)).toBe(childKey(id,0));
  });
  it("derives the upload namespace from the actual canonical database identity without credential differences",()=>{
    const a="postgresql://one:private@localhost:5432/fixture",b="postgresql://two:different@localhost:5432/fixture";
    expect(uploadTargetFingerprint(a)).toBe(uploadTargetFingerprint(b));
    expect(uploadTargetFingerprint(a)).toBe(uploadCoreHash({namespace:"durtal.upload.target.v1",database:databaseFingerprint(a)}));
  });
  it("refuses a creation receipt whose response belongs to another batch",()=>{
    const input={key:id,protocol:1 as const,files:[{name:"book.epub",bytes:42,sha256:"c".repeat(64),target:{kind:"new" as const}}]};
    const receipt={version:1,request:batchRequest(input,context),operationId:id,parentOperationId:null,status:201,
      result:{id:other,key:id,runId:id,items:[]},effect:null};
    expect(()=>readUploadCoreReceipt(receipt)).toThrow("scope");
  });
  it("refuses command response status/key and inspection-scope corruption",()=>{
    const request=commandRequest(other,{action:"cancel",key:id},context);
    const receipt={version:1,request,operationId:other,parentOperationId:other,status:200,
      result:{operationId:other,key:id,status:200,message:"Canceled; originals retained.",preview:null},effect:null};
    expect(readUploadCoreReceipt(receipt).result).toEqual(receipt.result);
    expect(()=>readUploadCoreReceipt({...receipt,status:201})).toThrow();
    expect(()=>readUploadCoreReceipt({...receipt,inspectionSha256:"c".repeat(64)})).toThrow("Inspection");
    expect(()=>readUploadCoreReceipt({...receipt,result:{...receipt.result,key:other}})).toThrow();
  });
  it("bounds preview count and TTL and detects native Date mutation",()=>{
    let now=1_000;const cache=new UploadPreviewCache<{id:string;at:Date}>(()=>now);
    const original=cache.put({id,at:new Date(0)});
    const held=cache.get(original.token)!;held.at.setTime(5);
    expect(()=>cache.get(original.token)).toThrow("Frozen");
    const first=cache.put({id,at:new Date(0)});
    for (let i=0;i<128;i++) cache.put({id:String(i),at:new Date(i)});
    expect(cache.get(first.token)).toBeNull();
    const fresh=cache.put({id,at:new Date(0)});now+=10*60_000;
    expect(cache.get(fresh.token)).toBeNull();expect(cache.expiresAt(fresh.token)).toBeNull();
  });
  it("requires one named current replacement and never turns add-format into an implicit replacement",()=>{
    const registration={ebookId:id,newEbook:null,inserts:[{id:other}],items:[{outcome:"replaced_file"}],
      replaced:[{fileId:other,previousStatus:"stored"}]} as unknown as Registration;
    expect(()=>requireExplicitRegistrationIntent(registration,{kind:"add_format",ebookId:id})).toThrow();
    expect(()=>requireExplicitRegistrationIntent(registration,{kind:"replace",ebookId:id,fileId:other})).not.toThrow();
    expect(()=>requireExplicitRegistrationIntent({...registration,replaced:[...registration.replaced,{fileId:id,previousStatus:"stored"}]},
      {kind:"replace",ebookId:id,fileId:other})).toThrow();
    expect(()=>requireExplicitRegistrationIntent(registration,{kind:"replace",ebookId:id,fileId:id})).toThrow();
  });
});
