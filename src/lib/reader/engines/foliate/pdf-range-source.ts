import type { Prefetched } from "@/lib/reader/engine";
import { ReadError, type RangeSourceOptions } from "./remote-blob";
import { forPdfOwner } from "./pdf-lifetime";
import {
  PDF_MAX_CONCURRENT_RANGES,
  PDF_RANGE_CHUNK_BYTES,
  pdfRangeBodyMatches,
  pdfRangeResponsePolicy,
  type PdfByteRange,
} from "./pdf-range";

const CACHE_CHUNKS = 32;
const MAX_QUEUED_CHUNKS = 128;
const FALLBACK_KEY = "durtal-reader-app-route";
const aborted = (signal: AbortSignal) =>
  signal.reason ?? new DOMException("Cancelled", "AbortError");

interface Consumer {
  signal: AbortSignal;
  resolve(bytes: Uint8Array): void;
  reject(error: unknown): void;
  abort(): void;
}
interface Job {
  key: string;
  range: PdfByteRange;
  controller: AbortController;
  consumers: Set<Consumer>;
}

/** One opened PDF's shared byte reads. Individual consumers hold abortable leases. */
export class PdfRangeSource {
  readonly size: number;
  transferred = 0;
  requests = 0;
  #options: RangeSourceOptions;
  #url: string;
  #fallback = false;
  #fetch: typeof fetch;
  #refresh: Promise<void> | undefined;
  #refreshing = false;
  #jobs = new Map<string, Job>();
  #queue: Job[] = [];
  #active = 0;
  #closed = false;
  #cache = new Map<string, Uint8Array>();
  #prefetch: Promise<Prefetched[]>;

  constructor(options: RangeSourceOptions) {
    if (!Number.isSafeInteger(options.size) || options.size <= 0)
      throw new RangeError("Invalid PDF byte length");
    this.size = options.size;
    this.#options = options;
    this.#fetch = options.fetch ?? ((...args) => fetch(...args));
    try {
      this.#fallback = (sessionStorage.getItem(FALLBACK_KEY) ?? "")
        .split(",")
        .includes(options.ebookId);
    } catch {
      // Storage is optional; fallback still persists for this open document.
    }
    this.#url = this.#fallback ? options.fallbackUrl : options.url;
    this.#prefetch = options.prefetch?.catch(() => []) ?? Promise.resolve([]);
  }

  get activeRequests() {
    return this.#active;
  }

  /** Exactly one bounded interval; callers stream larger requests by chunk. */
  read(begin: number, end: number, signal: AbortSignal): Promise<Uint8Array> {
    if (
      ![begin, end].every(Number.isSafeInteger) ||
      begin < 0 ||
      end <= begin ||
      end > this.size ||
      end - begin > PDF_RANGE_CHUNK_BYTES
    )
      return Promise.reject(new RangeError("Invalid bounded PDF range"));
    if (this.#closed || signal.aborted)
      return Promise.reject(
        signal.aborted
          ? aborted(signal)
          : new DOMException("Closed", "AbortError"),
      );
    const key = `${begin}:${end}`;
    const cached = this.#cache.get(key);
    if (cached) {
      this.#cache.delete(key);
      this.#cache.set(key, cached);
      return forPdfOwner(Promise.resolve(cached.slice()), signal);
    }
    let job = this.#jobs.get(key);
    if (!job) {
      if (this.#queue.length >= MAX_QUEUED_CHUNKS)
        return Promise.reject(
          new ReadError("network", "PDF range queue is full"),
        );
      job = {
        key,
        range: { begin, end },
        controller: new AbortController(),
        consumers: new Set(),
      };
      this.#jobs.set(key, job);
      this.#queue.push(job);
    }
    const ownedJob = job;
    return new Promise<Uint8Array>((resolve, reject) => {
      const consumer: Consumer = {
        signal,
        resolve,
        reject,
        abort: () => {
          ownedJob.consumers.delete(consumer);
          signal.removeEventListener("abort", consumer.abort);
          reject(aborted(signal));
          if (!ownedJob.consumers.size) {
            ownedJob.controller.abort();
            if (this.#jobs.get(key) === ownedJob) this.#jobs.delete(key);
            this.#queue = this.#queue.filter((item) => item !== ownedJob);
          }
        },
      };
      ownedJob.consumers.add(consumer);
      signal.addEventListener("abort", consumer.abort, { once: true });
      this.#pump();
    });
  }

  #pump() {
    while (
      !this.#closed &&
      this.#active < PDF_MAX_CONCURRENT_RANGES &&
      this.#queue.length
    ) {
      const job = this.#queue.shift()!;
      if (!job.consumers.size) continue;
      this.#active++;
      void this.#load(job).then(
        (bytes) => this.#finish(job, bytes),
        (error: unknown) => this.#finish(job, null, error),
      );
    }
  }

  #finish(job: Job, bytes: Uint8Array | null, error?: unknown) {
    this.#active--;
    if (this.#jobs.get(job.key) === job) this.#jobs.delete(job.key);
    if (bytes && !this.#closed && !job.controller.signal.aborted) {
      this.#cache.set(job.key, bytes);
      while (this.#cache.size > CACHE_CHUNKS)
        this.#cache.delete(this.#cache.keys().next().value!);
    }
    for (const consumer of job.consumers) {
      consumer.signal.removeEventListener("abort", consumer.abort);
      if (consumer.signal.aborted) consumer.reject(aborted(consumer.signal));
      else if (this.#closed || job.controller.signal.aborted)
        consumer.reject(new DOMException("Closed", "AbortError"));
      else if (bytes) consumer.resolve(bytes.slice());
      else consumer.reject(error);
    }
    job.consumers.clear();
    this.#pump();
  }

  async #load(job: Job) {
    const signal = job.controller.signal;
    const prefetched = await forPdfOwner(this.#prefetch, signal);
    signal.throwIfAborted();
    for (const { start, bytes } of prefetched) {
      if (
        !Number.isSafeInteger(start) ||
        start < 0 ||
        bytes.byteLength > PDF_RANGE_CHUNK_BYTES ||
        start + bytes.byteLength > this.size
      )
        continue;
      if (start <= job.range.begin && start + bytes.byteLength >= job.range.end)
        return new Uint8Array(
          bytes.slice(job.range.begin - start, job.range.end - start),
        );
    }
    return this.#fetchRange(job.range, signal);
  }

  #useAppRoute() {
    this.#fallback = true;
    this.#url = this.#options.fallbackUrl;
    try {
      const ids = new Set(
        (sessionStorage.getItem(FALLBACK_KEY) ?? "").split(",").filter(Boolean),
      );
      ids.add(this.#options.ebookId);
      sessionStorage.setItem(FALLBACK_KEY, [...ids].join(","));
    } catch {
      // No storage is needed to keep this instance on the app route.
    }
  }

  async #fetchRange(
    range: PdfByteRange,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    signal.throwIfAborted();
    const viaCdn = this.#url !== this.#options.fallbackUrl;
    const requestedUrl = this.#url;
    try {
      this.requests++;
      const response = await this.#fetch(requestedUrl, {
        signal,
        headers: { Range: `bytes=${range.begin}-${range.end - 1}` },
      });
      signal.throwIfAborted();
      if (response.status === 403) {
        void response.body?.cancel().catch(() => {});
        if (
          viaCdn &&
          this.#options.refreshUrl &&
          (!this.#refresh || this.#refreshing || requestedUrl !== this.#url)
        ) {
          if (!this.#refresh) {
            this.#refreshing = true;
            this.#refresh = Promise.resolve()
              .then(this.#options.refreshUrl)
              .then(
                (url) => {
                  if (!this.#fallback) this.#url = url;
                },
                () => {},
              )
              .finally(() => {
                this.#refreshing = false;
              });
          }
          await forPdfOwner(this.#refresh, signal);
          if (requestedUrl !== this.#url)
            return this.#fetchRange(range, signal);
        }
        throw new ReadError("expired", "The link to this eBook has expired");
      }
      const policy = pdfRangeResponsePolicy({
        range,
        size: this.size,
        status: response.status,
        contentRange: response.headers.get("content-range"),
        contentLength: response.headers.get("content-length"),
        viaCdn,
      });
      if (policy !== "accept") {
        void response.body?.cancel().catch(() => {});
        if (policy === "retry-app") {
          this.#useAppRoute();
          return this.#fetchRange(range, signal);
        }
        throw new ReadError(
          "network",
          "The PDF server returned an invalid byte range",
        );
      }
      // Stream into an already bounded destination: even a dishonest 206
      // cannot cause arrayBuffer() to retain a whole PDF in memory.
      if (!response.body)
        throw new ReadError("network", "Empty PDF range response");
      const reader = response.body.getReader();
      const bytes = new Uint8Array(range.end - range.begin);
      let received = 0;
      try {
        for (;;) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          signal.throwIfAborted();
          if (done) break;
          this.transferred += value.byteLength;
          if (received + value.byteLength > bytes.byteLength)
            throw new ReadError(
              "network",
              "PDF range body exceeds its declared interval",
            );
          bytes.set(value, received);
          received += value.byteLength;
        }
        if (!pdfRangeBodyMatches(range, received))
          throw new ReadError("network", "Truncated PDF range response");
        return bytes;
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch (error) {
      signal.throwIfAborted();
      if (viaCdn && !(error instanceof ReadError && error.kind === "expired")) {
        this.#useAppRoute();
        return this.#fetchRange(range, signal);
      }
      throw error instanceof ReadError
        ? error
        : new ReadError(
            "network",
            error instanceof Error ? error.message : "PDF range request failed",
          );
    }
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const job of this.#jobs.values()) {
      job.controller.abort();
      for (const consumer of job.consumers) {
        consumer.signal.removeEventListener("abort", consumer.abort);
        consumer.reject(new DOMException("Closed", "AbortError"));
      }
      job.consumers.clear();
    }
    this.#jobs.clear();
    this.#queue = [];
    this.#cache.clear();
    this.#prefetch = Promise.resolve([]);
  }
}
