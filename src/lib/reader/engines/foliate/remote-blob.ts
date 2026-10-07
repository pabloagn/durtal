import type { OpenErrorKind, Prefetched } from "@/lib/reader/engine";

/**
 * The file's bytes over HTTP Range (eBooks sub-issue 3). The size is known
 * from the catalogue, so every request names an explicit range
 * (`bytes=a-b`): no suffix ranges and no conditional headers, which keeps a
 * cross-origin read from CloudFront a simple request with no CORS preflight.
 *
 * Reads are served from what was already fetched when they can be: the
 * page's prefetch, then a small cache of recent ranges. A miss fetches at
 * least 64 KiB, so the many small reads of a zip or a MOBI header become a
 * few requests. An expired signed URL (403 from CloudFront) is refreshed once
 * and the read retried; a network failure against CloudFront moves this book
 * to the app route for the rest of the session.
 */

const MIN_FETCH = 64 * 1024;
/** Fetched ranges kept for reuse: entries are decoded and cached above this */
const CACHE_BYTES = 8 * 1024 * 1024;
const FALLBACK_KEY = "durtal-reader-app-route";

export class ReadError extends Error {
  constructor(
    readonly kind: OpenErrorKind,
    message: string,
  ) {
    super(message);
  }
}

export interface RangeSourceOptions {
  /** Unique per book: the session's fallback to the app route is per book */
  ebookId: string;
  url: string;
  fallbackUrl: string;
  size: number;
  refreshUrl?: () => Promise<string>;
  prefetch?: Promise<Prefetched[]>;
  fetch?: typeof fetch;
}

interface Chunk {
  start: number;
  bytes: Uint8Array;
}

/** Books that switched to the app route this session */
function usesAppRoute(ebookId: string): boolean {
  try {
    return (sessionStorage.getItem(FALLBACK_KEY) ?? "").split(",").includes(ebookId);
  } catch {
    return false;
  }
}

function rememberAppRoute(ebookId: string) {
  try {
    const ids = new Set((sessionStorage.getItem(FALLBACK_KEY) ?? "").split(",").filter(Boolean));
    ids.add(ebookId);
    sessionStorage.setItem(FALLBACK_KEY, [...ids].join(","));
  } catch {
    // No storage: the switch lasts for this page only
  }
}

export class RangeSource {
  readonly size: number;
  /** Bytes received, for the performance harness */
  transferred = 0;
  requests = 0;
  #url: string;
  #options: RangeSourceOptions;
  #chunks: Chunk[] = [];
  #cached = 0;
  #prefetch: Promise<void> | null;
  #refreshed = false;
  #fetch: typeof fetch;

  constructor(options: RangeSourceOptions) {
    this.size = options.size;
    this.#options = options;
    this.#url = usesAppRoute(options.ebookId) ? options.fallbackUrl : options.url;
    this.#fetch = options.fetch ?? ((...args) => fetch(...args));
    this.#prefetch = options.prefetch
      ? options.prefetch.then(
          (got) => {
            for (const { start, bytes } of got) if (bytes.byteLength) this.#keep({ start, bytes: new Uint8Array(bytes) });
          },
          () => undefined,
        )
      : null;
  }

  /**
   * Bytes [start, end), end exclusive and clamped to the file. Each read is
   * its own buffer: zip.js reads the array's buffer from its first byte. A
   * miss fetches up to `ahead` when the caller knows what it reads next (a
   * zip entry's data after its header).
   */
  async read(start: number, end: number = this.size, ahead = 0): Promise<Uint8Array> {
    end = Math.min(end, this.size);
    start = Math.max(0, Math.min(start, end));
    if (end === start) return new Uint8Array(0);
    if (this.#prefetch) await this.#prefetch;
    const hit = this.#find(start, end);
    if (hit) return hit;
    // The read's start may be here already (pdf.js asks for a page's image
    // from the end of its first 64 KiB, inside the page's prefetch): only the
    // rest is fetched
    const { parts, to: from } = this.#cachedFrom(start, end);
    let chunk: Chunk | null = null;
    if (from < end) {
      chunk = await this.#fetchRange(from, Math.min(this.size, Math.max(end, from + MIN_FETCH, ahead)));
      this.#keep(chunk);
      if (!parts.length) return chunk.bytes.slice(start - chunk.start, end - chunk.start);
    }
    // Pieces held end to end, then what was fetched
    const bytes = new Uint8Array(end - start);
    let at = 0;
    for (const part of parts) {
      bytes.set(part, at);
      at += part.byteLength;
    }
    if (chunk) bytes.set(chunk.bytes.subarray(from - chunk.start, end - chunk.start), at);
    return bytes;
  }

  /** The cached bytes from `start` on, while they run unbroken, and where they stop */
  #cachedFrom(start: number, end: number): { parts: Uint8Array[]; to: number } {
    const parts: Uint8Array[] = [];
    let at = start;
    while (at < end) {
      const chunk = this.#chunks.find((c) => c.start <= at && c.start + c.bytes.byteLength > at);
      if (!chunk) break;
      const stop = Math.min(end, chunk.start + chunk.bytes.byteLength);
      parts.push(chunk.bytes.subarray(at - chunk.start, stop - chunk.start));
      at = stop;
    }
    return { parts, to: at };
  }

  #find(start: number, end: number): Uint8Array | null {
    for (let i = this.#chunks.length - 1; i >= 0; i--) {
      const chunk = this.#chunks[i];
      if (chunk.start <= start && chunk.start + chunk.bytes.byteLength >= end) {
        // Most recently used last
        this.#chunks.splice(i, 1);
        this.#chunks.push(chunk);
        return chunk.bytes.slice(start - chunk.start, end - chunk.start);
      }
    }
    return null;
  }

  #keep(chunk: Chunk) {
    // A range larger than the cache is used once and not kept
    if (chunk.bytes.byteLength > CACHE_BYTES) return;
    this.#chunks.push(chunk);
    this.#cached += chunk.bytes.byteLength;
    while (this.#cached > CACHE_BYTES && this.#chunks.length > 1) {
      this.#cached -= this.#chunks.shift()!.bytes.byteLength;
    }
  }

  async #fetchRange(start: number, end: number): Promise<Chunk> {
    const viaCdn = this.#url !== this.#options.fallbackUrl;
    let response: Response;
    try {
      this.requests++;
      response = await this.#fetch(this.#url, { headers: { Range: `bytes=${start}-${end - 1}` } });
    } catch (error) {
      if (viaCdn) {
        // CloudFront cannot be reached: the app route serves the same bytes
        rememberAppRoute(this.#options.ebookId);
        this.#url = this.#options.fallbackUrl;
        return this.#fetchRange(start, end);
      }
      throw new ReadError("network", error instanceof Error ? error.message : "The connection failed");
    }
    if (response.status === 403 && viaCdn && this.#options.refreshUrl && !this.#refreshed) {
      this.#refreshed = true;
      this.#url = await this.#options.refreshUrl().catch(() => this.#url);
      return this.#fetchRange(start, end);
    }
    if (response.status === 403) throw new ReadError("expired", "The link to this eBook has expired");
    if (response.status !== 206 && response.status !== 200)
      throw new ReadError("network", `The file could not be read (${response.status})`);
    const body = new Uint8Array(await response.arrayBuffer());
    this.transferred += body.byteLength;
    if (response.status === 200) {
      // The server sent the whole file: keep the part asked for
      return { start, bytes: body.slice(start, end) };
    }
    const range = /^bytes (\d+)-(\d+)\//.exec(response.headers.get("content-range") ?? "");
    const from = range ? Number(range[1]) : start;
    return { start: from, bytes: body };
  }
}

/**
 * A Blob-like view of the remote file for MOBI, AZW3, FB2 and PDF: the engine
 * reads `size`, `type`, `name` and `slice(a, b).arrayBuffer()`, and accepts
 * this unchanged (foliate-js pdf.js makePDF, mobi.js PDB.open).
 */
export class RemoteBlob {
  readonly size: number;
  readonly type: string;
  readonly name: string;

  constructor(
    private readonly source: RangeSource,
    type: string,
    name: string,
    private readonly start = 0,
    end = source.size,
  ) {
    this.size = Math.max(0, end - start);
    this.type = type;
    this.name = name;
  }

  slice(start = 0, end: number = this.size): RemoteBlob {
    const clamp = (n: number) => (n < 0 ? Math.max(0, this.size + n) : Math.min(n, this.size));
    const from = clamp(start);
    const to = Math.max(from, clamp(end));
    return new RemoteBlob(this.source, this.type, this.name, this.start + from, this.start + to);
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    const bytes = await this.source.read(this.start, this.start + this.size);
    return bytes.buffer as ArrayBuffer;
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(await this.arrayBuffer());
  }
}
