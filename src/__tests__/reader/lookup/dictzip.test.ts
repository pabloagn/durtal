import { describe, expect, it, vi } from "vitest";
import { constants, createDeflateRaw, crc32, gunzipSync } from "node:zlib";
import {
  inflateDictzipChunk,
  LookupCrc32,
  readDictzipHeader,
  verifyDictzip,
} from "@/lib/reader/lookup/dictzip";
import type { StarDictByteSource } from "@/lib/reader/lookup/stardict";

const bytes = (text: string) => new TextEncoder().encode(text);
function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}
async function packed(headerChecksum = false) {
  const original = [bytes("0123456789"), bytes("abcdefghij"), bytes("last")];
  const stream = createDeflateRaw(),
    outputs: Uint8Array[] = [],
    chunks: Uint8Array[] = [];
  stream.on("data", (chunk: Uint8Array) => outputs.push(chunk));
  for (const part of original) {
    await new Promise<void>((resolve, reject) => {
      stream.once("error", reject);
      stream.write(part);
      stream.flush(constants.Z_FULL_FLUSH, () => {
        stream.removeListener("error", reject);
        resolve();
      });
    });
    chunks.push(concat(...outputs.splice(0)));
  }
  await new Promise<void>((resolve, reject) => {
    stream.once("error", reject);
    stream.once("end", resolve);
    stream.end();
  });
  const finish = concat(...outputs),
    header = new Uint8Array(28 + (headerChecksum ? 2 : 0)),
    view = new DataView(header.buffer);
  expect(finish).toEqual(new Uint8Array([3, 0]));
  header.set([31, 139, 8, headerChecksum ? 6 : 4]);
  view.setUint16(10, 16, true);
  header.set([82, 65], 12);
  view.setUint16(14, 12, true);
  view.setUint16(16, 1, true);
  view.setUint16(18, original[0].length, true);
  view.setUint16(20, chunks.length, true);
  chunks.forEach((chunk, at) =>
    view.setUint16(22 + at * 2, chunk.length, true),
  );
  if (headerChecksum)
    view.setUint16(
      header.length - 2,
      crc32(header.subarray(0, header.length - 2)) & 65535,
      true,
    );
  const data = concat(...original),
    tail = new Uint8Array(10),
    footer = new DataView(tail.buffer);
  tail.set(finish);
  footer.setUint32(2, crc32(data), true);
  footer.setUint32(6, data.length, true);
  return { file: concat(header, ...chunks, tail), original, chunks, header };
}
function source(
  file: Uint8Array,
): StarDictByteSource & { read: ReturnType<typeof vi.fn> } {
  return {
    size: file.length,
    read: vi.fn(async (at: number, length: number, signal?: AbortSignal) => {
      signal?.throwIfAborted();
      return file.slice(at, at + length);
    }),
  };
}

describe("native dictzip boundary and integrity validation", () => {
  it("matches an independent CRC implementation across window boundaries", () => {
    const value = bytes("123456789"),
      crc = new LookupCrc32();
    value.forEach((byte) => crc.update(new Uint8Array([byte])));
    expect(crc.digest()).toBe(0xcbf43926);
    expect(crc.digest()).toBe(crc32(value));
    const unicode = bytes("λόγος שלום àéîöù"),
      next = new LookupCrc32();
    next.update(unicode.subarray(0, 7));
    next.update(unicode.subarray(7));
    expect(next.digest()).toBe(crc32(unicode));
  });
  it.each([false, true])(
    "verifies a complete writer-style dictionary with FHCRC=%s",
    async (headerChecksum) => {
      const fixture = await packed(headerChecksum),
        input = source(fixture.file),
        signal = new AbortController().signal;
      expect(new Uint8Array(gunzipSync(fixture.file))).toEqual(
        concat(...fixture.original),
      );
      const header = await verifyDictzip(input, signal);
      expect(header.uncompressedBytes).toBe(BigInt(24));
      input.read.mockClear();
      const output: Uint8Array[] = [];
      await inflateDictzipChunk(input, header, 1, signal, (chunk) =>
        output.push(chunk),
      );
      expect(concat(...output)).toEqual(fixture.original[1]);
      expect(input.read).toHaveBeenCalledExactlyOnceWith(
        header.chunks[1].offset,
        fixture.chunks[1].length,
        signal,
      );
    },
  );
  it("rejects an RA boundary error even when the whole gzip stream and CRC are valid", async () => {
    const fixture = await packed(),
      altered = fixture.file.slice(),
      view = new DataView(altered.buffer);
    view.setUint16(22, fixture.chunks[0].length + 1, true);
    view.setUint16(24, fixture.chunks[1].length - 1, true);
    expect(new Uint8Array(gunzipSync(altered))).toEqual(
      concat(...fixture.original),
    );
    await expect(
      verifyDictzip(source(altered), new AbortController().signal),
    ).rejects.toThrow();
  });
  it("rejects corrupted dictionary/footer/header checksums and incorrect chunk output lengths", async () => {
    const fixture = await packed(true);
    for (const at of [
      fixture.file.length - 8,
      fixture.file.length - 4,
      fixture.header.length - 2,
      // The first bit of compressed data is BFINAL, not dictionary content.
      // Mutate the following payload byte so the data/CRC contract is exercised.
      fixture.header.length + 1,
    ]) {
      const altered = fixture.file.slice();
      altered[at] ^= 1;
      await expect(
        verifyDictzip(source(altered), new AbortController().signal),
      ).rejects.toThrow();
    }
    const altered = fixture.file.slice();
    new DataView(altered.buffer).setUint16(18, 11, true);
    new DataView(altered.buffer).setUint16(
      fixture.header.length - 2,
      crc32(altered.subarray(0, fixture.header.length - 2)) & 65535,
      true,
    );
    await expect(
      verifyDictzip(source(altered), new AbortController().signal),
    ).rejects.toThrow();
  });
  it("stops reading chunks on abort and refuses arbitrary chunk indexes", async () => {
    const fixture = await packed(),
      input = source(fixture.file),
      parent = new AbortController();
    const { header } = await readDictzipHeader(input, parent.signal);
    input.read.mockClear();
    await expect(
      inflateDictzipChunk(input, header, 99, parent.signal, () => {}),
    ).rejects.toThrow(/outside/);
    expect(input.read).not.toHaveBeenCalled();
    parent.abort(new DOMException("closed", "AbortError"));
    await expect(verifyDictzip(input, parent.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(input.read).not.toHaveBeenCalled();
  });
});
