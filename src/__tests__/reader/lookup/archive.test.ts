import { describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import {
  checkPackZipDirectory,
  consumePackFile,
  openPackInput,
  type PackInputFile,
} from "@/lib/reader/lookup/archive";
import { PACK_IMPORT_LIMITS } from "@/lib/reader/lookup/pack-limits";
import { parseStarDictEntry } from "@/lib/reader/lookup/stardict";

const bytes = (text: string) => new TextEncoder().encode(text);
const signal = () => new AbortController().signal;
const input = (data: Uint8Array): PackInputFile => ({
  name: "synthetic",
  size: data.length,
  writeTo: (destination, parent) =>
    new Blob([data.slice()]).stream().pipeTo(destination, { signal: parent }),
});
async function zipped(
  names = ["pack/test.ifo", "pack/test.idx", "pack/test.dict"],
) {
  const writer = new ZipWriter(new BlobWriter(), {
    useWebWorkers: false,
    level: 0,
  });
  for (const name of names)
    await writer.add(
      name,
      new BlobReader(
        new Blob([
          name.endsWith(".ifo")
            ? "StarDict synthetic metadata"
            : "synthetic bytes",
        ]),
      ),
    );
  return new File([await writer.close()], "dictionary.zip");
}

describe("bounded dictionary archive and native inflation", () => {
  it("bounds the central directory before zip.js can enumerate it", () => {
    const tail = new Uint8Array(68),
      view = new DataView(tail.buffer);
    view.setUint32(46, 0x06054b50, true);
    view.setUint16(54, 1, true);
    view.setUint16(56, 1, true);
    view.setUint32(58, 46, true);
    expect(checkPackZipDirectory(tail, tail.length)).toEqual({
      count: 1,
      directoryBytes: 46,
      offset: 0,
    });
    for (const [at, value, width] of [
      [50, 1, 2],
      [52, 1, 2],
      [54, 2, 2],
      [56, 65535, 2],
      [58, PACK_IMPORT_LIMITS.centralDirectoryBytes + 1, 4],
      [62, 1, 4],
      [66, 1, 2],
    ]) {
      const altered = tail.slice(),
        table = new DataView(altered.buffer);
      if (width === 2) table.setUint16(at, value, true);
      else table.setUint32(at, value, true);
      expect(() => checkPackZipDirectory(altered, altered.length)).toThrow();
    }
    expect(() =>
      checkPackZipDirectory(tail, PACK_IMPORT_LIMITS.archiveBytes + 1),
    ).toThrow();
    expect(() => checkPackZipDirectory(tail.subarray(0, 67), 67)).toThrow();
  });
  it("selects one bounded pack from a real zip and rejects traversal or multiple packs", async () => {
    const selected = await openPackInput([await zipped()], signal());
    expect(selected).toMatchObject({
      compressedIndex: false,
      dictzip: false,
      synonyms: null,
    });
    const chunks: Uint8Array[] = [];
    await consumePackFile(selected.info, false, 1000, signal(), (chunk) =>
      chunks.push(chunk),
    );
    expect(new TextDecoder().decode(chunks[0])).toBe(
      "StarDict synthetic metadata",
    );
    await selected.close();
    await expect(
      openPackInput(
        [await zipped(["../test.ifo", "../test.idx", "../test.dict"])],
        signal(),
      ),
    ).rejects.toThrow(/unsafe/i);
    await expect(
      openPackInput(
        [await zipped(["one.ifo", "two.idx", "one.dict"])],
        signal(),
      ),
    ).rejects.toThrow(/one StarDict/);
  });
  it("verifies the actual zip CRC while reading, rather than trusting its advertised size", async () => {
    const valid = await zipped(),
      data = new Uint8Array(await valid.arrayBuffer());
    const needle = bytes("StarDict synthetic metadata");
    let start = -1;
    for (let at = 0; at <= data.length - needle.length; at++)
      if (needle.every((byte, i) => data[at + i] === byte)) {
        start = at;
        break;
      }
    expect(start).toBeGreaterThan(0);
    data[start] ^= 1;
    const selected = await openPackInput(
      [new File([data], "dictionary.zip")],
      signal(),
    );
    await expect(
      consumePackFile(selected.info, false, 1000, signal(), () => {}),
    ).rejects.toThrow();
    await selected.close();
  });
  it("uses native gzip CRC/ISIZE checks and rejects inflation beyond the output cap", async () => {
    const original = bytes("synthetic gzip dictionary"),
      packed = new Uint8Array(gzipSync(original));
    const decoded: Uint8Array[] = [];
    expect(
      await consumePackFile(
        input(packed),
        true,
        original.length,
        signal(),
        (chunk) => decoded.push(chunk),
      ),
    ).toBe(original.length);
    expect(Buffer.concat(decoded)).toEqual(Buffer.from(original));
    for (const at of [packed.length - 8, packed.length - 4]) {
      const corrupt = packed.slice();
      corrupt[at] ^= 1;
      await expect(
        consumePackFile(
          input(corrupt),
          true,
          original.length,
          signal(),
          () => {},
        ),
      ).rejects.toThrow();
    }
    await expect(
      consumePackFile(
        input(packed),
        true,
        original.length - 1,
        signal(),
        () => {},
      ),
    ).rejects.toThrow(/size limit/);
    await expect(
      consumePackFile(
        input(packed.subarray(0, packed.length - 1)),
        true,
        original.length,
        signal(),
        () => {},
      ),
    ).rejects.toThrow();
  });
  it("cancels a stalled input and never starts a producer for an already canceled operation", async () => {
    const parent = new AbortController(),
      canceled = vi.fn();
    const stalled: PackInputFile = {
      name: "stall",
      size: 1,
      writeTo: (destination, current) =>
        new ReadableStream<Uint8Array>({ cancel: canceled }).pipeTo(
          destination,
          { signal: current },
        ),
    };
    const pending = consumePackFile(stalled, false, 1, parent.signal, () => {}),
      rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    parent.abort(new DOMException("removed", "AbortError"));
    await rejected;
    expect(canceled).toHaveBeenCalledTimes(1);
    const never = { ...stalled, writeTo: vi.fn(stalled.writeTo) };
    await expect(
      consumePackFile(never, false, 1, parent.signal, () => {}),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(never.writeTo).not.toHaveBeenCalled();
  });
  it("bounds mixed entry part counts independently of the raw entry byte cap", () => {
    expect(() => parseStarDictEntry(bytes("m\0".repeat(33)), null)).toThrow(
      /display parts/,
    );
    const binary = new Uint8Array(5 * 4097);
    for (let at = 0; at < binary.length; at += 5)
      binary[at] = "W".charCodeAt(0);
    expect(() => parseStarDictEntry(binary, null)).toThrow(/too many parts/);
  });
});
