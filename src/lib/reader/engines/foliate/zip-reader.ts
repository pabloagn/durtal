import type { RangeSource } from "./remote-blob";
import type { ZipEntry, ZipLoader, ZipModule, ZipReaderLike } from "./foliate";
import { scanMarkup } from "./position-index";

/**
 * EPUB, FB2Z and CBZ straight from the zip over HTTP Range (eBooks
 * sub-issue 3). zip.js reads the central directory (already prefetched by
 * the page as the HTML arrived) and then only the entries the engine asks
 * for. Decoded entries are kept in a small LRU, so turning back to a section
 * or reloading a stylesheet costs nothing.
 */

/** Room for a local header's name and extra field, which may differ from the central directory's */
const LOCAL_HEADER_SLACK = 30 + 1024;
/** An entry larger than this is not fetched with its header: its data is read on its own */
const MAX_READ_AHEAD = 4 * 1024 * 1024;

/** A zip.js reader over a file whose size the catalogue knows */
export class KnownSizeRangeReader implements ZipReaderLike {
  readonly size: number;
  readonly initialized = true;
  /**
   * Where each entry ends, by the offset of its local header: zip.js reads
   * the header, then the data right after it, so one request takes both
   */
  readonly entryEnds = new Map<number, number>();

  constructor(private readonly source: RangeSource) {
    this.size = source.size;
  }

  init() {}

  readUint8Array(index: number, length: number): Promise<Uint8Array> {
    return this.source.read(index, index + length, this.entryEnds.get(index));
  }

  /** zip.js streams an entry's data from here: one read for the whole entry */
  get readable(): ReadableStream<Uint8Array> & {
    offset?: number;
    size?: number;
  } {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const reader = this;
    const readable: ReadableStream<Uint8Array> & {
      offset?: number;
      size?: number;
    } = new ReadableStream({
      async pull(controller) {
        const { offset = 0, size = 0 } = readable;
        if (size) controller.enqueue(await reader.readUint8Array(offset, size));
        controller.close();
      },
    });
    return readable;
  }
}

const MAX_ENTRIES = 32;
const MAX_BYTES = 8 * 1024 * 1024;

/** Decoded entries, least recently used first out: at most 32 and 8 MB */
export class EntryCache<T> {
  #map = new Map<string, { value: T; bytes: number }>();
  #bytes = 0;

  get(key: string): T | undefined {
    const hit = this.#map.get(key);
    if (!hit) return undefined;
    this.#map.delete(key);
    this.#map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T, bytes: number) {
    if (bytes > MAX_BYTES) return;
    const old = this.#map.get(key);
    if (old) {
      this.#bytes -= old.bytes;
      this.#map.delete(key);
    }
    this.#map.set(key, { value, bytes });
    this.#bytes += bytes;
    for (const [oldest, entry] of this.#map) {
      if (this.#map.size <= MAX_ENTRIES && this.#bytes <= MAX_BYTES) break;
      this.#map.delete(oldest);
      this.#bytes -= entry.bytes;
    }
  }

  delete(key: string) {
    const old = this.#map.get(key);
    if (!old) return;
    this.#bytes -= old.bytes;
    this.#map.delete(key);
  }

  get size() {
    return this.#map.size;
  }

  get bytes() {
    return this.#bytes;
  }
}

/** Up to `want` bytes of a raw deflate stream's output, from the start of the stream only */
async function inflateHead(
  compressed: Uint8Array,
  want: number,
): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") return null;
  const stream = new Blob([compressed as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  try {
    while (got < want) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      got += value.byteLength;
    }
  } catch {
    // The stream ends mid-block: what came out before is still good
  }
  reader.cancel().catch(() => {});
  if (!got) return null;
  const out = new Uint8Array(Math.min(got, want));
  let at = 0;
  for (const part of parts) {
    const take = part.subarray(
      0,
      Math.min(part.byteLength, out.byteLength - at),
    );
    out.set(take, at);
    at += take.byteLength;
    if (at === out.byteLength) break;
  }
  return out;
}

/** The first bytes of an entry, stored or deflated, without reading the rest of it */
async function readEntryHead(
  source: RangeSource,
  entry: ZipEntry,
  want: number,
): Promise<Uint8Array | null> {
  const { offset, compressionMethod } = entry;
  if (
    offset === undefined ||
    (compressionMethod !== 0 && compressionMethod !== 8)
  )
    return null;
  const span = Math.min(entry.compressedSize, want);
  const raw = await source.read(offset, offset + LOCAL_HEADER_SLACK + span);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  if (raw.byteLength < 30 || view.getUint32(0, true) !== 0x04034b50)
    return null;
  const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  const data =
    raw.byteLength >= start + span
      ? raw.subarray(start, start + span)
      : await source.read(offset + start, offset + start + span);
  return compressionMethod === 0
    ? data.slice(0, want)
    : inflateHead(data, want);
}

/** The loader foliate-js's EPUB, comic book and FB2Z readers take */
export async function makeRangeZipLoader(
  zip: ZipModule,
  source: RangeSource,
): Promise<ZipLoader> {
  zip.configure({ useWebWorkers: false });
  const ranges = new KnownSizeRangeReader(source);
  const reader = new zip.ZipReader(ranges);
  const entries = await reader.getEntries();
  for (const entry of entries) {
    if (entry.offset === undefined || entry.compressedSize > MAX_READ_AHEAD)
      continue;
    ranges.entryEnds.set(
      entry.offset,
      entry.offset +
        LOCAL_HEADER_SLACK +
        entry.filename.length * 4 +
        entry.compressedSize,
    );
  }
  const map = new Map<string, ZipEntry>(
    entries.map((entry) => [entry.filename, entry]),
  );
  const texts = new EntryCache<Promise<string>>();
  const blobs = new EntryCache<Promise<Blob>>();

  const loadText = (name: string): Promise<string | null> => {
    const entry = map.get(name);
    if (!entry) return Promise.resolve(null);
    const cached = texts.get(name);
    if (cached) return cached;
    const text = entry.getData<string>(new zip.TextWriter());
    texts.set(name, text, entry.uncompressedSize * 2);
    // A failed read is not kept: the next attempt reads again
    text.catch(() => texts.delete(name));
    return text;
  };
  const loadBlob = (name: string, type?: string): Promise<Blob | null> => {
    const entry = map.get(name);
    if (!entry) return Promise.resolve(null);
    const key = `${name}\u0000${type ?? ""}`;
    const cached = blobs.get(key);
    if (cached) return cached;
    const blob = entry.getData<Blob>(new zip.BlobWriter(type));
    blobs.set(key, blob, entry.uncompressedSize);
    blob.catch(() => blobs.delete(key));
    return blob;
  };
  const readHead = (name: string, want: number): Promise<Uint8Array | null> => {
    const entry = map.get(name);
    return entry
      ? readEntryHead(source, entry, want).catch(() => null)
      : Promise.resolve(null);
  };
  const scanIndex: NonNullable<ZipLoader["scanIndex"]> = async (
    name,
    fragments,
    signal,
  ) => {
    const entry = map.get(name);
    if (
      !entry ||
      entry.uncompressedSize < 128 * 1024 ||
      typeof Worker === "undefined"
    ) {
      return scanMarkup((await loadText(name)) ?? "", fragments, signal);
    }
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    if (
      entry.offset === undefined ||
      ![0, 8].includes(entry.compressionMethod ?? -1)
    )
      throw new Error(
        "This section cannot be indexed without blocking reading.",
      );
    // Read only this entry's compressed data. Its large decode happens in the index worker.
    const header = await source.read(
      entry.offset,
      entry.offset + LOCAL_HEADER_SLACK,
    );
    const view = new DataView(
      header.buffer,
      header.byteOffset,
      header.byteLength,
    );
    const start =
      entry.offset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
    const compressed = await source.read(start, start + entry.compressedSize);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const { scanInWorker } = await import("./index-worker-client");
    const bytes = compressed.slice();
    return scanInWorker(
      {
        fragments,
        compressed: bytes.buffer as ArrayBuffer,
        method: entry.compressionMethod,
      },
      signal,
    );
  };
  return {
    entries,
    loadText,
    loadBlob,
    readHead,
    scanIndex,
    getSize: (name) => map.get(name)?.uncompressedSize ?? 0,
    getComment: async () =>
      reader.comment?.byteLength
        ? new TextDecoder().decode(reader.comment)
        : null,
  };
}
