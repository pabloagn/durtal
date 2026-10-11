import { randomBytes } from "node:crypto";
import { privateRegistrationInput, registrationInputSha256 } from "../ingest/registration-input";

/** Server-owned native plans only. A token never carries SQL, an issuer, a
 * writer or arbitrary client plan data. Entries expire without releasing bytes.
 */
export class UploadPreviewCache<T extends object> {
  private readonly entries=new Map<string,{value:T;hash:string;bytes:number;expiresAt:number}>();
  private retainedBytes=0;
  constructor(private readonly now:()=>number=Date.now) {}
  private drop(token:string):void {
    const entry=this.entries.get(token);
    if (entry) {this.retainedBytes-=entry.bytes;this.entries.delete(token);}
  }
  delete(token:string):void {this.drop(token);}
  put(value:T):{token:string;expiresAt:string} {
    this.sweep();
    // The canonical core hash supports native Date-bearing Registration plans.
    const frozen=privateRegistrationInput(value),hash=registrationInputSha256(frozen);
    const bytes=Buffer.byteLength(JSON.stringify(frozen));
    if (bytes>32*1024*1024 || !Number.isSafeInteger(bytes)) throw new Error("Upload preview exceeds its bounded storage");
    while (this.entries.size>=128 || this.retainedBytes+bytes>32*1024*1024) {
      const oldest=this.entries.keys().next().value;
      if (oldest===undefined) throw new Error("Upload preview exceeds cache capacity");
      this.drop(oldest);
    }
    const token=randomBytes(32).toString("hex"),expiresAt=this.now()+10*60_000;
    this.entries.set(token,{value:frozen,hash,bytes,expiresAt});this.retainedBytes+=bytes;
    return {token,expiresAt:new Date(expiresAt).toISOString()};
  }
  get(token:string):T|null {
    this.sweep();const entry=this.entries.get(token);
    if (!entry) return null;
    if (registrationInputSha256(entry.value)!==entry.hash) {this.drop(token);throw new Error("Frozen upload plan changed");}
    return entry.value;
  }
  expiresAt(token:string):string|null {
    this.sweep();const entry=this.entries.get(token);
    return entry ? new Date(entry.expiresAt).toISOString():null;
  }
  private sweep():void {
    const now=this.now();if (!Number.isSafeInteger(now)) throw new Error("Invalid upload preview clock");
    for (const [token,entry] of this.entries) if (entry.expiresAt<=now) this.drop(token);
  }
}
