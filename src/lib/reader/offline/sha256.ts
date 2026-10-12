/** Incremental SHA-256. At most one input chunk plus a 64-byte tail is retained.
 * The downloader uses this in a dedicated worker, never on the input thread.
 */
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
const rotate = (value: number, n: number) => (value >>> n) | (value << (32-n));
export class IncrementalSha256 {
  private state = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  private words = new Uint32Array(64);
  private tail = new Uint8Array(64);
  private used = 0;
  private total = 0;
  private finished = false;
  update(bytes: Uint8Array) {
    if (this.finished) throw new Error("Hash already finalized");
    this.total += bytes.byteLength;
    if (!Number.isSafeInteger(this.total)) throw new Error("Hash input too large");
    let offset = 0;
    if (this.used) {
      const take = Math.min(64-this.used, bytes.length);
      this.tail.set(bytes.subarray(0,take),this.used); this.used += take; offset += take;
      if (this.used === 64) { this.block(this.tail,0); this.used = 0; }
    }
    while (offset+64 <= bytes.length) { this.block(bytes,offset); offset += 64; }
    if (offset < bytes.length) { this.tail.set(bytes.subarray(offset),0); this.used = bytes.length-offset; }
  }
  digest(): string {
    if (this.finished) throw new Error("Hash already finalized");
    this.finished = true;
    const end = new Uint8Array(this.used < 56 ? 64 : 128); end.set(this.tail.subarray(0,this.used)); end[this.used] = 0x80;
    const bits = BigInt(this.total)*BigInt(8), view = new DataView(end.buffer);
    view.setUint32(end.length-8,Number(bits >> BigInt(32))); view.setUint32(end.length-4,Number(bits & BigInt(0xffffffff)));
    for (let at = 0; at < end.length; at += 64) this.block(end,at);
    return [...this.state].map(value => value.toString(16).padStart(8,"0")).join("");
  }
  private block(bytes: Uint8Array, offset: number) {
    const w = this.words;
    for (let i=0; i<16; i++) { const at=offset+i*4; w[i] = (bytes[at]<<24)|(bytes[at+1]<<16)|(bytes[at+2]<<8)|bytes[at+3]; }
    for (let i=16; i<64; i++) {
      const a=w[i-15],b=w[i-2];
      w[i] = w[i-16]+(rotate(a,7)^rotate(a,18)^(a>>>3))+w[i-7]+(rotate(b,17)^rotate(b,19)^(b>>>10));
    }
    let [a,b,c,d,e,f,g,h] = this.state;
    for (let i=0; i<64; i++) {
      const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+K[i]+w[i])>>>0;
      const t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
      h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
    }
    [a,b,c,d,e,f,g,h].forEach((value,index) => { this.state[index] += value; });
  }
}
