import type { RangeSource } from "./remote-blob";
import type { ZipEntry, ZipLoader, ZipModule, ZipReaderLike } from "./foliate";

/**
 * EPUB, FB2Z and CBZ straight from the zip over HTTP Range (eBooks
 * sub-issue 3). zip.js reads the central directory (already prefetched by
 * the page as the HTML arrived) and then only the entries the engine asks
 * for. Decoded entries are kept in a small LRU, so turning back to a section
 * or reloading a stylesheet costs nothing.
 */

/** A zip.js reader over a file whose size the catalogue knows */
export class KnownSizeRangeReader implements ZipReaderLike {
  readonly size: number;
  readonly initialized = true;

  constructor(private readonly source: RangeSource) {
    this.size = source.size;
  }

  init() {}

  readUint8Array(index: number, length: number): Promise<Uint8Array> {
    return this.source.read(index, index + length);
  }

  /** zip.js streams an entry's data from here: one read for the whole entry */
  get readable(): ReadableStream<Uint8Array> & { offset?: number; size?: number } {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const reader = this;
    const readable: ReadableStream<Uint8Array> & { offset?: number; size?: number } = new ReadableStream({
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

/** The loader foliate-js's EPUB, comic book and FB2Z readers take */
export async function makeRangeZipLoader(zip: ZipModule, source: RangeSource): Promise<ZipLoader> {
  zip.configure({ useWebWorkers: false });
  const reader = new zip.ZipReader(new KnownSizeRangeReader(source));
  const entries = await reader.getEntries();
  const map = new Map<string, ZipEntry>(entries.map((entry) => [entry.filename, entry]));
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
  return {
    entries,
    loadText,
    loadBlob,
    getSize: (name) => map.get(name)?.uncompressedSize ?? 0,
    getComment: async () => (reader.comment?.byteLength ? new TextDecoder().decode(reader.comment) : null),
  };
}
