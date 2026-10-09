import type { BookSource } from "@/lib/reader/engine";
import type { TextContent } from "pdfjs-dist/types/src/display/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openPdfSession } from "@/lib/reader/engines/foliate/pdf-session";
import { PDFJS_VERSION } from "@/lib/reader/engines/foliate/pdf-options";
import { PDF_RANGE_CHUNK_BYTES } from "@/lib/reader/engines/foliate/pdf-range";

const source: BookSource = {
  ebookId: "isolated",
  fileId: "pdf",
  format: "pdf",
  size: 1024 * 1024,
  sha256: "c".repeat(64),
  url: "https://reader.example/bytes",
  fallbackUrl: "https://reader.example/bytes",
};
const base = `https://reader.example/vendor/pdfjs/${PDFJS_VERSION}/`;
const signal = () => new AbortController().signal;
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
const emptyContent: TextContent = { items: [], styles: {}, lang: null };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { resolve, promise };
}
function harness() {
  const nativePorts: {
    terminate: ReturnType<typeof vi.fn>;
    dispatchEvent(event: Event): boolean;
  }[] = [];
  class NativeWorker extends EventTarget {
    terminate = vi.fn();
    constructor() {
      super();
      nativePorts.push(this);
    }
  }
  vi.stubGlobal("Worker", NativeWorker);
  const page = {
    cleanup: vi.fn(),
    getTextContent: vi.fn(async () => emptyContent),
  };
  const pdf = {
    numPages: 50,
    getPage: vi.fn(async (_number: number) => page),
    getPageLabels: vi.fn(async (): Promise<string[] | null> => ["i"]),
  };
  const task = {
    promise: Promise.resolve(pdf),
    destroy: vi.fn(async () => {}),
  };
  const onDataRange = vi.fn();
  class Transport {
    requestDataRange = (_begin: number, _end: number) => {};
    abort = () => {};
    onDataRange = onDataRange;
  }
  const workerDestroy = vi.fn();
  const api = {
    version: PDFJS_VERSION,
    PDFWorker: {
      create: vi.fn(({ port }) => ({ port, destroy: workerDestroy })),
    },
    PDFDataRangeTransport: Transport,
    getDocument: vi.fn(() => task),
    TextLayer: class {},
  };
  const open = () =>
    openPdfSession(
      api as unknown as Parameters<typeof openPdfSession>[0],
      source,
      base,
      "https://reader.example",
    );
  return {
    api,
    open,
    page,
    pdf,
    task,
    nativePorts,
    workerDestroy,
    onDataRange,
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("concrete PDF document session", () => {
  it("passes the owned worker and exact reviewed options to the document", async () => {
    const h = harness();
    const session = await h.open();
    const args = h.api.getDocument.mock.calls[0] as unknown as [
      Record<string, unknown>,
    ];
    expect(args[0]).toMatchObject({
      rangeChunkSize: 262144,
      disableAutoFetch: true,
      disableStream: true,
      enableXfa: false,
      useWorkerFetch: true,
      canvasMaxAreaInBytes: 67108864,
      iccUrl: base + "iccs/",
    });
    expect(args[0].worker).toMatchObject({ port: h.nativePorts[0] });
    await session.destroy();
    expect(h.nativePorts[0].terminate).toHaveBeenCalledOnce();
  });

  it("joins bounded HTTP chunks into the one logical range pdf.js expects", async () => {
    const h = harness();
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) => {
        const [begin, last] = new Headers(init?.headers)
          .get("Range")!
          .match(/\d+/g)!
          .map(Number);
        expect(last + 1 - begin).toBeLessThanOrEqual(PDF_RANGE_CHUNK_BYTES);
        const bytes = new Uint8Array(last + 1 - begin).fill(
          begin / PDF_RANGE_CHUNK_BYTES,
        );
        return new Response(bytes, {
          status: 206,
          headers: { "content-range": `bytes ${begin}-${last}/${source.size}` },
        });
      },
    );
    vi.stubGlobal("fetch", fetcher);
    const session = await h.open();
    const args = h.api.getDocument.mock.calls[0] as unknown as [
      { range: { requestDataRange(begin: number, end: number): void } },
    ];
    const delivered = deferred<Uint8Array>();
    h.onDataRange.mockImplementation((_begin, bytes: Uint8Array) =>
      delivered.resolve(bytes),
    );
    args[0].range.requestDataRange(0, source.size);
    const bytes = await delivered.promise;
    expect(h.onDataRange).toHaveBeenCalledOnce();
    expect(bytes.length).toBe(source.size);
    expect([
      bytes[0],
      bytes[PDF_RANGE_CHUNK_BYTES],
      bytes[2 * PDF_RANGE_CHUNK_BYTES],
      bytes.at(-1),
    ]).toEqual([0, 1, 2, 3]);
    expect(fetcher).toHaveBeenCalledTimes(4);
    await session.destroy();
  });

  it("keeps a visible page leased while unrelated page lookups evict old cache entries", async () => {
    const h = harness();
    const pinned = { ...h.page, cleanup: vi.fn() };
    h.pdf.getPage.mockImplementation(async (number: number) =>
      number === 1 ? pinned : { ...h.page, cleanup: vi.fn() },
    );
    const session = await h.open();
    const visible = await session.acquirePage(0, signal());
    for (let index = 1; index < 20; index++) {
      const lease = await session.acquirePage(index, signal());
      lease.release();
    }
    expect(pinned.cleanup).not.toHaveBeenCalled();
    const again = await session.acquirePage(0, signal());
    expect(again.page).toBe(pinned);
    again.release();
    visible.release();
    await session.destroy();
  });

  it("aborting one text request preserves a shared producer and the surviving reader", async () => {
    const h = harness();
    const text = deferred<TextContent>();
    h.page.getTextContent.mockImplementation(() => text.promise);
    const session = await h.open();
    const owner = new AbortController();
    const first = session.pageTextContent(0, owner.signal);
    const second = session.pageTextContent(0, signal());
    const rejected = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    owner.abort();
    await rejected;
    text.resolve(emptyContent);
    expect(await second).toBe(emptyContent);
    expect(h.page.getTextContent).toHaveBeenCalledOnce();
    expect(h.task.destroy).not.toHaveBeenCalled();
    expect(h.workerDestroy).not.toHaveBeenCalled();
    await session.destroy();
  });

  it("bounds cached text even when every inspected page is empty", async () => {
    const h = harness();
    const session = await h.open();
    for (let index = 0; index < 20; index++)
      await session.pageTextContent(index, signal());
    expect(h.page.getTextContent).toHaveBeenCalledTimes(20);
    await session.pageTextContent(0, signal());
    expect(h.page.getTextContent).toHaveBeenCalledTimes(21);
    await session.destroy();
  });

  it("aborts a page consumer without invalidating the surviving page lease", async () => {
    const h = harness();
    const pending = deferred<typeof h.page>();
    h.pdf.getPage.mockImplementation(() => pending.promise);
    const session = await h.open();
    const owner = new AbortController();
    const first = session.acquirePage(0, owner.signal);
    const second = session.acquirePage(0, signal());
    const rejected = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    owner.abort();
    await rejected;
    pending.resolve(h.page);
    const lease = await second;
    expect(lease.page).toBe(h.page);
    expect(h.pdf.getPage).toHaveBeenCalledOnce();
    expect(h.page.cleanup).not.toHaveBeenCalled();
    expect(h.task.destroy).not.toHaveBeenCalled();
    lease.release();
    await session.destroy();
  });

  it("closes on a transport failure and never publishes the failed range", async () => {
    const h = harness();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    const session = await h.open();
    const rejected = expect(session.failure).rejects.toThrow(
      /invalid byte range/,
    );
    const args = h.api.getDocument.mock.calls[0] as unknown as [
      { range: { requestDataRange(begin: number, end: number): void } },
    ];
    args[0].range.requestDataRange(0, 100);
    await rejected;
    await session.destroy();
    expect(h.onDataRange).not.toHaveBeenCalled();
    expect(h.task.destroy).toHaveBeenCalledOnce();
  });

  it("exposes exact text identity and refuses offsets from a different file", async () => {
    const h = harness();
    const session = await h.open();
    const request = { fileHash: source.sha256, pageIndex: 0, signal: signal() };
    expect(await session.pdfPageText(request)).toEqual({
      fileHash: source.sha256,
      pageIndex: 0,
      pageLabel: "i",
      text: "",
    });
    await expect(
      session.pdfPageText({ ...request, fileHash: "d".repeat(64) }),
    ).rejects.toThrow(/different file/);
    await expect(
      session.pdfPageText({ ...request, pageIndex: 100 }),
    ).rejects.toThrow(/outside/);
    expect(
      await session.locatorForPdfTextOffsets(
        { ...request, start: 0, end: 1 },
        "",
      ),
    ).toBeNull();
    await session.destroy();
  });

  it("rejects label waiters on close and terminates a hanging destroy within one second", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.task.destroy.mockImplementation(() => new Promise(() => {}));
    h.pdf.getPageLabels.mockImplementation(() => new Promise(() => {}));
    const session = await h.open();
    const text = session.pdfPageText({
      fileHash: source.sha256,
      pageIndex: 0,
      signal: signal(),
    });
    const rejected = expect(text).rejects.toMatchObject({ name: "AbortError" });
    for (let index = 0; index < 10; index++) await Promise.resolve();
    expect(h.pdf.getPageLabels).toHaveBeenCalledOnce();
    const closed = session.destroy();
    expect(session.destroy()).toBe(closed);
    await rejected;
    expect(h.nativePorts[0].terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await closed;
    expect(h.nativePorts[0].terminate).toHaveBeenCalledOnce();
    expect(() => session.document).toThrow();
  });

  it("closes an opened session when its native worker fails", async () => {
    const h = harness();
    const session = await h.open();
    const rejected = expect(session.failure).rejects.toThrow(/worker failed/);
    h.nativePorts[0].dispatchEvent(new Event("error"));
    await rejected;
    await session.destroy();
    expect(h.task.destroy).toHaveBeenCalledOnce();
    expect(h.nativePorts[0].terminate).toHaveBeenCalledOnce();
  });

  it("cleans native resources if loading throws or rejects", async () => {
    const h = harness();
    h.api.getDocument.mockImplementationOnce(() => {
      throw new Error("getDocument");
    });
    await expect(h.open()).rejects.toThrow("getDocument");
    expect(h.nativePorts[0].terminate).toHaveBeenCalledOnce();
    const second = harness();
    second.task.promise = Promise.reject(new Error("load"));
    await expect(second.open()).rejects.toThrow("load");
    await tick();
    expect(second.task.destroy).toHaveBeenCalledOnce();
    expect(second.nativePorts[0].terminate).toHaveBeenCalledOnce();
  });
});
