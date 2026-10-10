import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { IncrementalSha256 } from "@/lib/reader/offline/sha256";
describe("bounded incremental SHA-256", () => {
  it.each([0,1,3,55,56,63,64,65,127,128,129,4096])("matches independent native hashing at padding boundary %i",size => {
    const bytes = Uint8Array.from({ length: size },(_,index) => (index*31)%256);
    for (const stride of [1,7,64,101]) {
      const hash = new IncrementalSha256();
      for (let at=0; at<bytes.length; at+=stride) hash.update(bytes.subarray(at,at+stride));
      expect(hash.digest()).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(() => hash.update(new Uint8Array())).toThrow("finalized");
    }
  });
  it("matches the published abc vector",() => {
    const hash = new IncrementalSha256(); hash.update(new TextEncoder().encode("abc"));
    expect(hash.digest()).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
