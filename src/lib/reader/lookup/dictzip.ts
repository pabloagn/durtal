import { consumeLookupStream, yieldLookupTasks } from "./resources";
import {
  STARDICT_LIMITS,
  parseDictzipHeader,
  type DictzipHeader,
  type StarDictByteSource,
} from "./stardict";

// CRC-32/ISO-HDLC: reflected polynomial 0xedb88320, initial/final xor 0xffffffff.
// The gzip trailer and FHCRC use this checksum (RFC 1952, sections 2.3.1 and 8).
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});
export class LookupCrc32 {
  private value = 0xffffffff;
  update(bytes: Uint8Array) {
    for (const byte of bytes)
      this.value = (this.value >>> 8) ^ crcTable[(this.value ^ byte) & 255];
  }
  digest() {
    return (this.value ^ 0xffffffff) >>> 0;
  }
}

export async function readDictzipHeader(
  source: StarDictByteSource,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (source.size < 20) throw new Error("The dictzip file is truncated");
  const prefix = await source.read(
      0,
      Math.min(source.size, STARDICT_LIMITS.headerBytes),
      signal,
    ),
    tail = await source.read(source.size - 10, 10, signal);
  const header = parseDictzipHeader(prefix, source.size, tail);
  if (prefix[3] & 2) {
    const end = header.chunks[0].offset,
      crc = new LookupCrc32();
    crc.update(prefix.subarray(0, end - 2));
    if (
      (crc.digest() & 65535) !==
      new DataView(
        prefix.buffer,
        prefix.byteOffset,
        prefix.byteLength,
      ).getUint16(end - 2, true)
    )
      throw new Error("The dictzip header checksum is invalid");
  }
  return {
    header,
    expectedCrc: new DataView(
      tail.buffer,
      tail.byteOffset,
      tail.byteLength,
    ).getUint32(2, true),
  };
}

/** Native raw inflation checks the RA boundary and exact output length for this chunk. */
export async function inflateDictzipChunk(
  source: StarDictByteSource,
  header: DictzipHeader,
  index: number,
  signal: AbortSignal,
  consume: (bytes: Uint8Array) => void,
) {
  signal.throwIfAborted();
  const chunk = header.chunks[index];
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    !chunk ||
    chunk.size < 1 ||
    chunk.size > 65535 ||
    chunk.offset < 0 ||
    chunk.offset + chunk.size > source.size - 10
  )
    throw new Error("The dictzip chunk is outside its file");
  if (typeof DecompressionStream === "undefined")
    throw new Error("This browser cannot inflate dictionary files");
  const bytes = await source.read(chunk.offset, chunk.size, signal);
  signal.throwIfAborted();
  if (bytes.length !== chunk.size)
    throw new Error("The dictzip chunk is truncated");
  const completed = new Uint8Array(bytes.length + 2);
  completed.set(bytes);
  completed.set([3, 0], bytes.length);
  const expected = Math.min(
    header.chunkLength,
    Number(header.uncompressedBytes) - index * header.chunkLength,
  );
  if (expected < 0 || expected > 65535)
    throw new Error("The dictzip chunk length is invalid");
  const stream = new Blob([completed])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const actual = await consumeLookupStream(stream, expected, signal, consume);
  if (actual !== expected)
    throw new Error("The dictzip chunk length does not match its header");
  return actual;
}

/** Validate every random-access boundary and the complete dictionary CRC before publication. */
export async function verifyDictzip(
  source: StarDictByteSource,
  signal: AbortSignal,
): Promise<DictzipHeader> {
  const { header, expectedCrc } = await readDictzipHeader(source, signal),
    crc = new LookupCrc32();
  let total = 0;
  for (let index = 0; index < header.chunks.length; index++) {
    if (index && index % 16 === 0) await yieldLookupTasks();
    signal.throwIfAborted();
    total += await inflateDictzipChunk(source, header, index, signal, (bytes) =>
      crc.update(bytes),
    );
  }
  if (
    BigInt(total) !== header.uncompressedBytes ||
    crc.digest() !== expectedCrc
  )
    throw new Error("The dictionary gzip checksum or length is invalid");
  return header;
}
