import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfRangeSource } from "@/lib/reader/engines/foliate/pdf-range-source";
import { PDF_RANGE_CHUNK_BYTES } from "@/lib/reader/engines/foliate/pdf-range";

const size = 10 * 1024 * 1024;
const options = {
  ebookId: "isolated-pdf",
  url: "https://cdn.example/pdf",
  fallbackUrl: "https://app.example/pdf",
  size,
};
const signal = () => new AbortController().signal;
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { resolve, reject, promise };
}
function rangeResponse(
  begin: number,
  end: number,
  bytes = new Uint8Array(end - begin),
  total = size,
) {
  return new Response(bytes as BodyInit, {
    status: 206,
    headers: {
      "content-range": `bytes ${begin}-${end - 1}/${total}`,
      "content-length": String(end - begin),
    },
  });
}

describe("bounded leased PDF byte source", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
  });
  afterEach(() => vi.unstubAllGlobals());
  it.each([undefined, `bytes */${size}`, "", "bytes */7"])(
    "rejects app PDF 416 with Content-Range %s and cancels without size discovery or retry",
    async (contentRange) => {
      const cancel = vi.fn();
      const headers: HeadersInit = contentRange === undefined ? {} : { "content-range": contentRange };
      const rejected = new Response(
        new ReadableStream({ cancel }, { highWaterMark: 0 }),
        { status: 416, headers },
      );
      const consume = vi.spyOn(rejected, "arrayBuffer");
      const acquireReader = vi.spyOn(rejected.body!, "getReader");
      const refreshUrl = vi.fn().mockResolvedValue("https://cdn.example/refreshed");
      const fetcher = vi.fn()
        .mockResolvedValueOnce(rejected)
        .mockResolvedValueOnce(rangeResponse(0, 100));
      const source = new PdfRangeSource({ ...options, url: options.fallbackUrl, fetch: fetcher, refreshUrl });
      try {
        await expect(source.read(0, 100, signal())).rejects.toMatchObject({ kind: "network" });
        expect(fetcher).toHaveBeenCalledOnce();
        expect(refreshUrl).not.toHaveBeenCalled();
        expect(consume).not.toHaveBeenCalled();
        expect(acquireReader).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledOnce();
        expect(source.transferred).toBe(0);
        expect(source.size).toBe(size);
        // The same explicit request must fetch again, never return error-body bytes.
        expect((await source.read(0, 100, signal())).byteLength).toBe(100);
        expect(fetcher.mock.calls.map(([url]) => url)).toEqual([options.fallbackUrl, options.fallbackUrl]);
        expect(refreshUrl).not.toHaveBeenCalled();
        expect(source.size).toBe(size);
      } finally {
        source.close();
      }
    },
  );

  it.each([206, 416])(
    "cancels a CDN 416 without Content-Range and makes one bounded app fallback returning %i",
    async (appStatus) => {
      const cancelCdn = vi.fn();
      const cdnError = new Response(
        new ReadableStream({ cancel: cancelCdn }, { highWaterMark: 0 }),
        { status: 416 },
      );
      const consumeCdn = vi.spyOn(cdnError, "arrayBuffer");
      const acquireCdnReader = vi.spyOn(cdnError.body!, "getReader");
      const cancelApp = vi.fn();
      const appError = new Response(
        new ReadableStream({ cancel: cancelApp }, { highWaterMark: 0 }),
        { status: 416 },
      );
      const consumeApp = vi.spyOn(appError, "arrayBuffer");
      const acquireAppReader = vi.spyOn(appError.body!, "getReader");
      const validBytes = new Uint8Array(100).fill(7);
      const refreshUrl = vi.fn().mockResolvedValue("https://cdn.example/refreshed");
      const fetcher = vi.fn()
        .mockResolvedValueOnce(cdnError)
        .mockResolvedValueOnce(appStatus === 206 ? rangeResponse(0, 100, validBytes) : appError)
        .mockResolvedValueOnce(rangeResponse(0, 100, validBytes));
      const source = new PdfRangeSource({ ...options, fetch: fetcher, refreshUrl });
      try {
        const first = source.read(0, 100, signal());
        if (appStatus === 206) {
          expect(Array.from(await first)).toEqual(Array.from(validBytes));
          expect(source.transferred).toBe(100);
        } else {
          await expect(first).rejects.toMatchObject({ kind: "network" });
          expect(source.transferred).toBe(0);
          expect(cancelApp).toHaveBeenCalledOnce();
        }
        // Exactly one automatic fallback; app 416 cannot create a retry loop.
        expect(fetcher.mock.calls.map(([url]) => url)).toEqual([options.url, options.fallbackUrl]);
        expect(cancelCdn).toHaveBeenCalledOnce();
        expect(consumeCdn).not.toHaveBeenCalled();
        expect(acquireCdnReader).not.toHaveBeenCalled();
        expect(consumeApp).not.toHaveBeenCalled();
        expect(acquireAppReader).not.toHaveBeenCalled();
        expect(refreshUrl).not.toHaveBeenCalled();
        expect(source.size).toBe(size);
        // Only successful bytes may be cached; rejected app bytes require a new explicit fetch.
        expect(Array.from(await source.read(0, 100, signal()))).toEqual(Array.from(validBytes));
        expect(fetcher).toHaveBeenCalledTimes(appStatus === 206 ? 2 : 3);
        if (appStatus === 416)
          expect(fetcher.mock.calls[2][0]).toBe(options.fallbackUrl);
        expect(source.transferred).toBe(100);
        expect(refreshUrl).not.toHaveBeenCalled();
        expect(source.size).toBe(size);
      } finally {
        source.close();
      }
    },
  );

  it("never dispatches more than six reads and starts queued work after completion", async () => {
    const responses = Array.from({ length: 8 }, () => deferred<Response>());
    const fetcher = vi.fn(
      (_url: RequestInfo | URL, _init?: RequestInit) =>
        responses[fetcher.mock.calls.length - 1].promise,
    );
    const source = new PdfRangeSource({ ...options, fetch: fetcher });
    const reads = Array.from({ length: 8 }, (_, n) =>
      source.read(n * 100, n * 100 + 100, signal()),
    );
    await tick();
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(source.activeRequests).toBe(6);
    responses[0].resolve(rangeResponse(0, 100));
    await reads[0];
    await tick();
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(7);
    for (let n = 1; n < 8; n++) {
      responses[n].resolve(rangeResponse(n * 100, n * 100 + 100));
      await reads[n];
      expect(source.activeRequests).toBeLessThanOrEqual(6);
    }
    expect(source.transferred).toBe(800);
    expect(source.requests).toBe(8);
    source.close();
  });

  it("shares a read while one consumer aborts, then isolates cached output buffers", async () => {
    const response = deferred<Response>();
    const fetcher = vi.fn(() => response.promise);
    const source = new PdfRangeSource({ ...options, fetch: fetcher });
    const owner = new AbortController();
    const first = source.read(0, 2, owner.signal);
    const second = source.read(0, 2, signal());
    const rejected = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    owner.abort();
    await rejected;
    response.resolve(rangeResponse(0, 2, new Uint8Array([7, 8])));
    const got = await second;
    got[0] = 99;
    expect(Array.from(await source.read(0, 2, signal()))).toEqual([7, 8]);
    expect(fetcher).toHaveBeenCalledOnce();
    source.close();
  });

  it("aborts the underlying request only after its last consumer leaves", async () => {
    const response = deferred<Response>();
    let transportSignal: AbortSignal | undefined;
    const source = new PdfRangeSource({
      ...options,
      fetch: vi.fn((_url, init) => {
        transportSignal = init?.signal ?? undefined;
        return response.promise;
      }),
    });
    const a = new AbortController(),
      b = new AbortController();
    const first = source.read(0, 100, a.signal),
      second = source.read(0, 100, b.signal);
    const all = Promise.allSettled([first, second]);
    await tick();
    await tick();
    a.abort();
    expect(transportSignal?.aborted).toBe(false);
    b.abort();
    expect(transportSignal?.aborted).toBe(true);
    expect((await all).every((item) => item.status === "rejected")).toBe(true);
    response.reject(new DOMException("abort", "AbortError"));
    source.close();
  });

  it("drops queued consumers and rejects close immediately even if fetch ignores abort", async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const source = new PdfRangeSource({ ...options, fetch: fetcher });
    const controllers = Array.from({ length: 8 }, () => new AbortController());
    const reads = controllers.map((owner, n) =>
      source.read(n * 100, n * 100 + 100, owner.signal),
    );
    const all = Promise.allSettled(reads);
    await tick();
    await tick();
    controllers[7].abort();
    source.close();
    source.close();
    expect((await all).every((item) => item.status === "rejected")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(6);
    await expect(source.read(0, 100, signal())).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("cancels whole-file CDN 200 without consuming it, then stays on the app route", async () => {
    const cancel = vi.fn();
    const whole = new Response(new ReadableStream({ cancel }), { status: 200 });
    const readWhole = vi.spyOn(whole, "arrayBuffer");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(whole)
      .mockResolvedValueOnce(rangeResponse(0, 100))
      .mockResolvedValueOnce(rangeResponse(100, 200));
    const source = new PdfRangeSource({ ...options, fetch: fetcher });
    await source.read(0, 100, signal());
    await source.read(100, 200, signal());
    expect(readWhole).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      options.url,
      options.fallbackUrl,
      options.fallbackUrl,
    ]);
    expect(source.transferred).toBe(200);
    source.close();
  });

  it("rejects app-route 200 and malformed headers before consuming their bodies", async () => {
    for (const status of [200, 206]) {
      const cancel = vi.fn();
      const response = new Response(new ReadableStream({ cancel }), { status });
      const readWhole = vi.spyOn(response, "arrayBuffer");
      const source = new PdfRangeSource({
        ...options,
        url: options.fallbackUrl,
        fetch: vi.fn().mockResolvedValue(response),
      });
      await expect(source.read(0, 100, signal())).rejects.toThrow(
        /invalid byte range/,
      );
      expect(readWhole).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledOnce();
      source.close();
    }
  });

  it.each([50, 150])(
    "refuses a decoded body of %i bytes for a 100-byte interval",
    async (length) => {
      const source = new PdfRangeSource({
        ...options,
        url: options.fallbackUrl,
        fetch: vi
          .fn()
          .mockResolvedValue(rangeResponse(0, 100, new Uint8Array(length))),
      });
      await expect(source.read(0, 100, signal())).rejects.toThrow(
        /Truncated|exceeds/,
      );
      source.close();
    },
  );

  it("shares one expired-URL refresh across simultaneous reads", async () => {
    const refresh = deferred<string>();
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        if (url === options.url) return new Response(null, { status: 403 });
        const [begin, end] = new Headers(init?.headers)
          .get("Range")!
          .match(/\d+/g)!
          .map(Number);
        return rangeResponse(begin, end + 1);
      },
    );
    const refreshUrl = vi.fn(() => refresh.promise);
    const source = new PdfRangeSource({
      ...options,
      fetch: fetcher,
      refreshUrl,
    });
    const first = source.read(0, 100, signal()),
      second = source.read(100, 200, signal());
    await tick();
    await tick();
    await tick();
    refresh.resolve("https://cdn.example/refreshed");
    await Promise.all([first, second]);
    expect(refreshUrl).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(4);
    source.close();
  });

  it("never refreshes an expired URL twice", async () => {
    const refreshUrl = vi.fn(async () => "https://cdn.example/refreshed");
    const source = new PdfRangeSource({
      ...options,
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
      refreshUrl,
    });
    await expect(source.read(0, 100, signal())).rejects.toMatchObject({
      kind: "expired",
    });
    expect(refreshUrl).toHaveBeenCalledOnce();
    expect(source.requests).toBe(2);
    source.close();
  });

  it("uses only bounded in-file prefetched bytes and does not block abort on unfinished prefetch", async () => {
    const fetcher = vi.fn().mockResolvedValue(rangeResponse(0, 100));
    const source = new PdfRangeSource({
      ...options,
      fetch: fetcher,
      prefetch: Promise.resolve([{ start: 0, bytes: new ArrayBuffer(size) }]),
    });
    await source.read(0, 100, signal());
    expect(fetcher).toHaveBeenCalledOnce();
    source.close();
    const pending = new PdfRangeSource({
      ...options,
      prefetch: new Promise(() => {}),
    });
    const read = pending.read(0, 100, signal());
    const rejected = expect(read).rejects.toMatchObject({ name: "AbortError" });
    pending.close();
    await rejected;
  });

  it("bounds retained chunk cache to eight MiB and honors abort on a cache hit", async () => {
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const [begin, last] = new Headers(init?.headers)
          .get("Range")!
          .match(/\d+/g)!
          .map(Number);
        return rangeResponse(begin, last + 1);
      },
    );
    const source = new PdfRangeSource({ ...options, fetch: fetcher });
    for (let n = 0; n < 33; n++)
      await source.read(
        n * PDF_RANGE_CHUNK_BYTES,
        (n + 1) * PDF_RANGE_CHUNK_BYTES,
        signal(),
      );
    const owner = new AbortController();
    const cached = source.read(
      32 * PDF_RANGE_CHUNK_BYTES,
      33 * PDF_RANGE_CHUNK_BYTES,
      owner.signal,
    );
    const rejected = expect(cached).rejects.toMatchObject({
      name: "AbortError",
    });
    owner.abort();
    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(33);
    await source.read(0, PDF_RANGE_CHUNK_BYTES, signal());
    expect(fetcher).toHaveBeenCalledTimes(34);
    source.close();
  });

  it("serves valid prefetched high byte offsets without fetching or integer truncation", async () => {
    const begin = 4 * 1024 ** 3;
    const fetcher = vi.fn();
    const source = new PdfRangeSource({
      ...options,
      size: begin + 100,
      fetch: fetcher,
      prefetch: Promise.resolve([
        { start: begin, bytes: new Uint8Array([1, 2, 3]).buffer },
      ]),
    });
    expect(
      Array.from(await source.read(begin + 1, begin + 3, signal())),
    ).toEqual([2, 3]);
    expect(fetcher).not.toHaveBeenCalled();
    source.close();
  });

  it("rejects unbounded/out-of-file requests before fetching, including high intervals", async () => {
    const fetcher = vi.fn();
    const source = new PdfRangeSource({
      ...options,
      fetch: fetcher,
      size: 5 * 1024 ** 3,
    });
    for (const [begin, end] of [
      [-1, 10],
      [0, PDF_RANGE_CHUNK_BYTES + 1],
      [0, 0],
      [5 * 1024 ** 3, 5 * 1024 ** 3 + 1],
    ])
      await expect(source.read(begin, end, signal())).rejects.toThrow(
        /bounded PDF/,
      );
    expect(fetcher).not.toHaveBeenCalled();
    source.close();
  });
});
