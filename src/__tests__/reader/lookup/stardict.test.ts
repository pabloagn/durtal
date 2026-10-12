import { describe, expect, it, vi } from "vitest";
import {
  constants,
  createDeflateRaw,
  gunzipSync,
  inflateRawSync,
} from "node:zlib";
import {
  STARDICT_LIMITS,
  buildStarDictOffsets,
  dictzipEntryChunks,
  parseDictzipHeader,
  parseStarDictEntry,
  parseStarDictIndexEntry,
  parseStarDictInfo,
  searchStarDictIndex,
  searchStarDictSynonyms,
  starDictValidationAllocation,
  stardictCompare,
  validateDictionaryRange,
  validateStarDictOffsets,
  type StarDictByteSource,
} from "@/lib/reader/lookup/stardict";

const encoder = new TextEncoder();
const word = (value: string) => encoder.encode(value);
function concat(...values: Uint8Array[]) {
  const bytes = new Uint8Array(
    values.reduce((sum, value) => sum + value.length, 0),
  );
  let at = 0;
  for (const value of values) {
    bytes.set(value, at);
    at += value.length;
  }
  return bytes;
}
function integer(value: number, bytes = 4) {
  const buffer = new Uint8Array(bytes),
    view = new DataView(buffer.buffer);
  if (bytes === 8) view.setBigUint64(0, BigInt(value), false);
  else view.setUint32(0, value, false);
  return buffer;
}
function entry(
  headword: string,
  offset: number,
  size: number,
  bits: 32 | 64 = 32,
) {
  return concat(
    word(headword),
    new Uint8Array([0]),
    integer(offset, bits / 8),
    integer(size),
  );
}
function source(
  bytes: Uint8Array,
): StarDictByteSource & { read: ReturnType<typeof vi.fn> } {
  return {
    size: bytes.length,
    read: vi.fn(async (at: number, length: number) =>
      bytes.slice(at, at + length),
    ),
  };
}
function info(index: Uint8Array, count: number, extra = "") {
  return parseStarDictInfo(
    `StarDict's dict ifo file\nversion=3.0.0\nbookname=Synthetic\nwordcount=${count}\nidxfilesize=${index.length}\n${extra}`,
  );
}

describe("StarDict metadata and byte order", () => {
  it("parses bounded metadata including 64-bit offsets and refuses ambiguous/corrupt headers", () => {
    expect(
      info(
        new Uint8Array(14),
        1,
        "idxoffsetbits=64\nlang=lat\nsametypesequence=mhx\nsynwordcount=1",
      ),
    ).toMatchObject({
      name: "Synthetic",
      offsetBits: 64,
      types: "mhx",
      language: "lat",
      synonymCount: 1,
    });
    for (const text of [
      "wrong header",
      "StarDict's dict ifo file\nversion=1\n",
      "StarDict's dict ifo file\nversion=3.0.0\nbookname=A\nwordcount=1\nwordcount=2\nidxfilesize=10",
    ])
      expect(() => parseStarDictInfo(text)).toThrow();
    expect(() => info(new Uint8Array(10), 1, "idxoffsetbits=48")).toThrow();
    expect(() => info(new Uint8Array(10), 1, "sametypesequence=m1")).toThrow();
  });
  it("folds ASCII only, with raw-byte tie breaks and non-ASCII UTF-8 order", () => {
    expect(stardictCompare(word("Haus"), word("haus"))).toBeLessThan(0);
    expect(stardictCompare(word("Z"), word("a"))).toBeGreaterThan(0);
    expect(stardictCompare(word("Ä"), word("ä"))).toBeLessThan(0);
    expect(stardictCompare(word("λόγος"), word("שלום"))).not.toBe(0);
  });
  it("reads an unaligned 64-bit entry without losing precision and guards ranges", () => {
    const large = 2 ** 32 + 17;
    const wrapped = concat(new Uint8Array([9]), entry("lux", large, 12, 64));
    expect(parseStarDictIndexEntry(wrapped.subarray(1), 64)).toMatchObject({
      headword: "lux",
      offset: BigInt(large),
      size: 12,
    });
    expect(() =>
      validateDictionaryRange(BigInt(large), 12, BigInt(large + 11)),
    ).toThrow();
    expect(() =>
      validateDictionaryRange(BigInt(large), 12, BigInt(large + 12)),
    ).not.toThrow();
    expect(() =>
      parseStarDictIndexEntry(
        new Uint8Array([255, 0, 0, 0, 0, 0, 0, 0, 0, 1]),
        32,
      ),
    ).toThrow(/UTF-8/);
  });
});

describe("bounded offset construction and lazy search", () => {
  it("finds duplicate, case-insensitive, Greek and Hebrew entries without decoding all words", async () => {
    const words = ["Haus", "haus", "lux", "lux", "λόγος", "שלום"].sort((a, b) =>
      stardictCompare(word(a), word(b)),
    );
    const bytes = concat(
      ...words.map((value, at) => entry(value, at * 10, 10)),
    );
    const input = source(bytes);
    const { offsets } = await buildStarDictOffsets({
      info: info(bytes, words.length),
      index: input,
      dictionaryBytes: BigInt(60),
      limits: { ...STARDICT_LIMITS, readBytes: 7 },
    });
    validateStarDictOffsets(offsets, bytes.length, words.length);
    expect(offsets[offsets.length - 1]).toBe(bytes.length);
    input.read.mockClear();
    expect(await searchStarDictIndex(input, offsets, "lux", 32)).toHaveLength(
      2,
    );
    expect(
      input.read.mock.calls.every(([, length]) => length < bytes.length),
    ).toBe(true);
    expect(
      (await searchStarDictIndex(input, offsets, "HAUS", 32)).map(
        (value) => value.headword,
      ),
    ).toEqual(["Haus", "haus"]);
    expect(
      (await searchStarDictIndex(input, offsets, "λόγος", 32))[0].headword,
    ).toBe("λόγος");
    expect(
      (await searchStarDictIndex(input, offsets, "שלום", 32))[0].headword,
    ).toBe("שלום");
    expect(await searchStarDictIndex(input, offsets, "missing", 32)).toEqual(
      [],
    );
  });
  it("validates synonyms and returns their referenced entries, with exact-case preference", async () => {
    const bytes = concat(entry("light", 0, 5), entry("lux", 5, 5));
    const synonyms = concat(
      word("Lamp"),
      new Uint8Array([0]),
      integer(1),
      word("lamp"),
      new Uint8Array([0]),
      integer(0),
    );
    const pack = info(bytes, 2, "synwordcount=2");
    const { synOffsets } = await buildStarDictOffsets({
      info: pack,
      index: source(bytes),
      synonyms: source(synonyms),
      dictionaryBytes: BigInt(10),
    });
    expect(
      await searchStarDictSynonyms(source(synonyms), synOffsets!, "Lamp", 2),
    ).toEqual([1]);
    expect(
      await searchStarDictSynonyms(source(synonyms), synOffsets!, "LAMP", 2),
    ).toEqual([1, 0]);
    const bad = concat(word("lamp"), new Uint8Array([0]), integer(2));
    await expect(
      buildStarDictOffsets({
        info: info(bytes, 2, "synwordcount=1"),
        index: source(bytes),
        synonyms: source(bad),
        dictionaryBytes: BigInt(10),
      }),
    ).rejects.toThrow(/outside/);
  });
  it("rejects count/order/size/range/truncation errors and cancellation", async () => {
    const cases = [
      {
        bytes: concat(entry("z", 0, 1), entry("a", 1, 1)),
        count: 2,
        dict: 2,
        pattern: /byte order/,
      },
      { bytes: entry("a", 0, 3), count: 1, dict: 2, pattern: /outside/ },
      {
        bytes: concat(entry("a", 0, 1), entry("b", 1, 1)),
        count: 1,
        dict: 2,
        pattern: /more entries/,
      },
      {
        bytes: entry("a", 0, 1).slice(0, -1),
        count: 1,
        dict: 1,
        pattern: /cannot fit|entry count/,
      },
    ];
    for (const value of cases)
      await expect(
        buildStarDictOffsets({
          info: info(value.bytes, value.count),
          index: source(value.bytes),
          dictionaryBytes: BigInt(value.dict),
        }),
      ).rejects.toThrow(value.pattern);
    const bytes = entry("a", 0, 1);
    await expect(
      buildStarDictOffsets({
        info: { ...info(bytes, 1), indexBytes: bytes.length + 1 },
        index: source(bytes),
        dictionaryBytes: BigInt(1),
      }),
    ).rejects.toThrow(/bytes expected/);
    const signal = AbortSignal.abort();
    const input = source(bytes);
    await expect(
      buildStarDictOffsets({
        info: info(bytes, 1),
        index: input,
        dictionaryBytes: BigInt(1),
        signal,
      }),
    ).rejects.toThrow();
    expect(input.read).not.toHaveBeenCalled();
    expect(() =>
      validateStarDictOffsets(new Uint32Array([0, 9, 8]), 8, 2),
    ).toThrow();
  });
  it("accounts both offset arrays and temporary buffers before allocation or reads", async () => {
    const tiny = entry("a", 0, 1);
    const metadata = info(tiny, 1, "synwordcount=1");
    const allocation = starDictValidationAllocation(metadata, 6);
    expect(allocation.offsetsBytes).toBe(16);
    expect(allocation.temporaryBytes).toBeGreaterThan(
      STARDICT_LIMITS.readBytes * 2,
    );
    const index = source(tiny),
      synonyms = source(concat(word("b"), new Uint8Array([0]), integer(0)));
    await expect(
      buildStarDictOffsets({
        info: metadata,
        index,
        synonyms,
        dictionaryBytes: BigInt(1),
        limits: {
          ...STARDICT_LIMITS,
          validationBytes: allocation.totalBytes - 1,
        },
      }),
    ).rejects.toThrow(/memory limit/);
    expect(index.read).not.toHaveBeenCalled();
    expect(synonyms.read).not.toHaveBeenCalled();
    const big = {
      ...metadata,
      wordCount: 5_000_000,
      indexBytes: 100_000_000,
      synonymCount: 5_000_000,
    };
    expect(() => starDictValidationAllocation(big, 100_000_000)).toThrow(
      /memory limit/,
    );
  });
  it("requires logarithmic probes in a larger sorted index", async () => {
    const count = 2048;
    const bytes = concat(
      ...Array.from({ length: count }, (_, at) =>
        entry(`word${String(at).padStart(5, "0")}`, at, 1),
      ),
    );
    const input = source(bytes);
    const { offsets } = await buildStarDictOffsets({
      info: info(bytes, count),
      index: input,
      dictionaryBytes: BigInt(count),
    });
    input.read.mockClear();
    expect(
      (await searchStarDictIndex(input, offsets, "word01888", 32))[0].offset,
    ).toBe(BigInt(1888));
    expect(input.read.mock.calls.length).toBeLessThanOrEqual(14);
  });
});

describe("dictionary entry types and dictzip chunk bounds", () => {
  it("parses m/h/x and mixed binary data, with the final sequence part consuming the remainder", () => {
    expect(
      parseStarDictEntry(
        concat(
          word("plain"),
          new Uint8Array([0]),
          word("<b>html</b>"),
          new Uint8Array([0]),
          word("<k>lux</k>"),
        ),
        "mhx",
      ),
    ).toEqual([
      { type: "m", text: "plain" },
      { type: "h", text: "<b>html</b>" },
      { type: "x", text: "<k>lux</k>" },
    ]);
    expect(
      parseStarDictEntry(
        concat(
          word("mplain"),
          new Uint8Array([0]),
          word("W"),
          integer(3),
          new Uint8Array([0, 255, 0]),
          word("h<b>gloss</b>"),
          new Uint8Array([0]),
        ),
        null,
      ),
    ).toEqual([
      { type: "m", text: "plain" },
      { type: "h", text: "<b>gloss</b>" },
    ]);
    expect(parseStarDictEntry(new Uint8Array([255, 0]), "W")).toEqual([]);
    expect(() => parseStarDictEntry(word("mnot terminated"), null)).toThrow(
      /unterminated/,
    );
    expect(() =>
      parseStarDictEntry(concat(word("W"), integer(100)), null),
    ).toThrow(/outside/);
    expect(() => parseStarDictEntry(word("one"), "mm")).toThrow();
  });
  it("checks RA tables and selects only chunks spanning an entry", () => {
    const header = new Uint8Array(26),
      view = new DataView(header.buffer);
    header.set([31, 139, 8, 4]);
    view.setUint16(10, 14, true);
    header.set([82, 65], 12);
    view.setUint16(14, 10, true);
    view.setUint16(16, 1, true);
    view.setUint16(18, 1000, true);
    view.setUint16(20, 2, true);
    view.setUint16(22, 300, true);
    view.setUint16(24, 250, true);
    const tail = new Uint8Array(10);
    tail.set([3, 0]);
    new DataView(tail.buffer).setUint32(6, 1800, true);
    const parsed = parseDictzipHeader(header, 586, tail);
    expect(dictzipEntryChunks(parsed, BigInt(990), 20)).toEqual([
      { offset: 26, size: 300, index: 0 },
      { offset: 326, size: 250, index: 1 },
    ]);
    expect(dictzipEntryChunks(parsed, BigInt(1000), 0)).toEqual([]);
    expect(() => dictzipEntryChunks(parsed, BigInt(1790), 20)).toThrow();
    expect(() => parseDictzipHeader(header, 587, tail)).toThrow(/file size/);
    expect(() => parseDictzipHeader(header, 584, tail.subarray(2))).toThrow();
    const invalidTail = tail.slice();
    invalidTail[0] = 2;
    expect(() => parseDictzipHeader(header, 586, invalidTail)).toThrow();
    const bad = header.slice();
    bad[12] = 0;
    expect(() => parseDictzipHeader(bad, 586, tail)).toThrow(/no dictzip RA/);
    expect(() => parseDictzipHeader(header.subarray(0, 20), 586, tail)).toThrow(
      /truncated/,
    );
  });
  it("rejects adversarial RA byte counts and malformed tail/footer bounds", () => {
    const header = new Uint8Array(26),
      view = new DataView(header.buffer);
    header.set([31, 139, 8, 4]);
    view.setUint16(10, 14, true);
    header.set([82, 65], 12);
    view.setUint16(14, 10, true);
    view.setUint16(16, 1, true);
    view.setUint16(18, 1000, true);
    view.setUint16(20, 2, true);
    view.setUint16(22, 300, true);
    view.setUint16(24, 250, true);
    const tail = new Uint8Array(10);
    tail.set([3, 0]);
    new DataView(tail.buffer).setUint32(6, 1800, true);
    for (const [at, value] of [
      [10, 13],
      [14, 9],
      [16, 2],
      [18, 0],
      [20, 0],
      [20, 3],
      [22, 0],
      [22, 301],
      [24, 65535],
    ]) {
      const altered = header.slice();
      new DataView(altered.buffer).setUint16(at, value, true);
      expect(() => parseDictzipHeader(altered, 586, tail)).toThrow();
    }
    for (const size of [0, 999, 2001, 0xffffffff]) {
      const altered = tail.slice();
      new DataView(altered.buffer).setUint32(6, size, true);
      expect(() => parseDictzipHeader(header, 586, altered)).toThrow(
        /uncompressed size/,
      );
    }
    for (const altered of [
      tail.subarray(0, 9),
      concat(tail, new Uint8Array(1)),
      new Uint8Array([3, 1, ...tail.subarray(2)]),
    ])
      expect(() => parseDictzipHeader(header, 586, altered)).toThrow();
    for (const size of [
      -1,
      19,
      585,
      587,
      Number.NaN,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      expect(() => parseDictzipHeader(header, size, tail)).toThrow();
    // ByteOffset-sensitive views must read the actual ten-byte tail, not the parent buffer.
    const parent = concat(
      new Uint8Array([255, 255]),
      tail,
      new Uint8Array([255]),
    );
    expect(
      parseDictzipHeader(header, 586, parent.subarray(2, 12)).uncompressedBytes,
    ).toBe(BigInt(1800));
  });
  it("accepts a writer-style streaming gzip with independently readable full-flush chunks", async () => {
    const parts = [word("dictionary"), word(" entries")];
    // Match dictzip.c: one stream, full-flush each indexed chunk, then finish with no input.
    const deflater = createDeflateRaw(),
      output: Uint8Array[] = [],
      chunks: Uint8Array[] = [];
    deflater.on("data", (bytes: Uint8Array) => output.push(bytes));
    for (const part of parts) {
      await new Promise<void>((resolve, reject) => {
        deflater.once("error", reject);
        deflater.write(part);
        deflater.flush(constants.Z_FULL_FLUSH, () => {
          deflater.removeListener("error", reject);
          resolve();
        });
      });
      chunks.push(concat(...output.splice(0)));
    }
    await new Promise<void>((resolve, reject) => {
      deflater.once("error", reject);
      deflater.once("end", resolve);
      deflater.end();
    });
    const finalBlock = concat(...output);
    expect(finalBlock).toEqual(new Uint8Array([3, 0]));
    chunks.forEach((chunk, at) =>
      expect(new Uint8Array(inflateRawSync(concat(chunk, finalBlock)))).toEqual(
        parts[at],
      ),
    );
    const header = new Uint8Array(26),
      view = new DataView(header.buffer);
    header.set([31, 139, 8, 4]);
    view.setUint16(10, 14, true);
    header.set([82, 65], 12);
    view.setUint16(14, 10, true);
    view.setUint16(16, 1, true);
    view.setUint16(18, parts[0].length, true);
    view.setUint16(20, chunks.length, true);
    chunks.forEach((chunk, at) =>
      view.setUint16(22 + at * 2, chunk.length, true),
    );
    const data = concat(...parts),
      tail = new Uint8Array(10);
    tail.set(finalBlock);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const tailView = new DataView(tail.buffer);
    tailView.setUint32(2, (crc ^ 0xffffffff) >>> 0, true);
    tailView.setUint32(6, data.length, true);
    const packed = concat(header, ...chunks, tail);
    expect(new Uint8Array(gunzipSync(packed))).toEqual(data);
    const badCrc = packed.slice();
    badCrc[badCrc.length - 8] ^= 1;
    expect(() => gunzipSync(badCrc)).toThrow();
    const badSize = packed.slice();
    badSize[badSize.length - 4] ^= 1;
    expect(() => gunzipSync(badSize)).toThrow();
    expect(parseDictzipHeader(header, packed.length, tail)).toMatchObject({
      uncompressedBytes: BigInt(data.length),
      chunks: chunks.map((chunk, index) => ({
        offset: header.length + (index ? chunks[0].length : 0),
        size: chunk.length,
      })),
    });
  });
});
