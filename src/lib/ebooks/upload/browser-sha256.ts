import { checkedInteger, UPLOAD_LIMITS } from "./limits";
import type { PartReceipt } from "./parts";

const K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
const rotate = (value: number, bits: number) => value >>> bits | value << 32 - bits;
/** Incremental browser hash: fixed 64-byte block/schedule, no 4 GiB ArrayBuffer. */
export class BrowserSha256 {
  private readonly state = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  private readonly block = new Uint8Array(64);
  private readonly words = new Uint32Array(64);
  private filled = 0; private bytes = 0; private ended = false;
  private compress() {
    const view = new DataView(this.block.buffer);
    for (let i = 0; i < 16; i++) this.words[i] = view.getUint32(i * 4);
    for (let i = 16; i < 64; i++) {
      const x = this.words[i - 15], y = this.words[i - 2];
      this.words[i] = this.words[i - 16] + (rotate(x, 7) ^ rotate(x, 18) ^ x >>> 3) + this.words[i - 7] + (rotate(y, 17) ^ rotate(y, 19) ^ y >>> 10);
    }
    let [a,b,c,d,e,f,g,h] = this.state;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + (e & f ^ ~e & g) + K[i] + this.words[i]) >>> 0;
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + (a & b ^ a & c ^ b & c)) >>> 0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    [a,b,c,d,e,f,g,h].forEach((value, index) => { this.state[index] += value; });
  }
  update(bytes: Uint8Array): this {
    if (this.ended) throw new Error("Hash is already complete");
    this.bytes = checkedInteger(this.bytes + bytes.length, "browser hashed bytes", 0, UPLOAD_LIMITS.sourceBytes);
    for (let offset = 0; offset < bytes.length;) {
      const take = Math.min(64 - this.filled, bytes.length - offset);
      this.block.set(bytes.subarray(offset, offset + take), this.filled); this.filled += take; offset += take;
      if (this.filled === 64) { this.compress(); this.filled = 0; }
    }
    return this;
  }
  digest(): string {
    if (this.ended) throw new Error("Hash is already complete"); this.ended = true;
    this.block[this.filled++] = 0x80; this.block.fill(0, this.filled);
    if (this.filled > 56) { this.compress(); this.block.fill(0); }
    const view = new DataView(this.block.buffer);
    view.setUint32(56, Math.floor(this.bytes / 0x20000000)); view.setUint32(60, this.bytes * 8 >>> 0); this.compress();
    return Array.from(this.state, (word) => word.toString(16).padStart(8, "0")).join("");
  }
}
export interface BrowserFileEvidence { sha256: string; parts: PartReceipt[] }
export async function fingerprintUploadFile(file: Blob, signal: AbortSignal, progress: (bytes: number) => void = () => {}): Promise<BrowserFileEvidence> {
  checkedInteger(file.size, "selected file bytes", 1, UPLOAD_LIMITS.sourceBytes);
  const full = new BrowserSha256(); const parts: PartReceipt[] = [];
  for (let offset = 0; offset < file.size; offset += UPLOAD_LIMITS.partBytes) {
    signal.throwIfAborted();
    const bytes = new Uint8Array(await file.slice(offset, offset + UPLOAD_LIMITS.partBytes).arrayBuffer());
    signal.throwIfAborted();
    for (let at = 0; at < bytes.length; at += 64 * 1024) {
      signal.throwIfAborted(); full.update(bytes.subarray(at, at + 64 * 1024));
      if ((at + 64 * 1024) % (1024 * 1024) === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const hash = await crypto.subtle.digest("SHA-256", bytes); signal.throwIfAborted();
    const sha256 = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
    parts.push({ number: parts.length + 1, bytes: bytes.length, sha256 }); progress(offset + bytes.length);
    // Yield between bounded parts so cancel/render can run during large files.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return { sha256: full.digest(), parts };
}
