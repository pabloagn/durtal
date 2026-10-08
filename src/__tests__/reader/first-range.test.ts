import { describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import {
  MOBI_HEAD_BYTES,
  PDF_HEAD_BYTES,
  PDF_TAIL_BYTES,
  PDF_WORKER_GLOBAL,
  PREFETCH_GLOBAL,
  ZIP_HEAD_BYTES,
  ZIP_TAIL_BYTES,
  firstRanges,
  prefetchScript,
} from "@/lib/reader/first-range";

/* SLN-492: the byte ranges the reader page asks for with its HTML */

const MB = 1024 * 1024;

describe("firstRanges", () => {
  it("asks a zip for its central directory and its first 64 KiB", () => {
    expect(firstRanges("epub", 5 * MB, 4_973_583)).toEqual([
      { start: 4_973_583, end: 5 * MB - 1 },
      { start: 0, end: ZIP_HEAD_BYTES - 1 },
    ]);
  });

  it("reads the zip's tail when the catalogue has no central directory offset", () => {
    expect(firstRanges("cbz", 5 * MB, null)[0]).toEqual({ start: 5 * MB - ZIP_TAIL_BYTES, end: 5 * MB - 1 });
    // An offset outside the file is not trusted
    expect(firstRanges("kepub", 5 * MB, 6 * MB)[0]).toEqual({ start: 5 * MB - ZIP_TAIL_BYTES, end: 5 * MB - 1 });
  });

  it("asks a small zip for all of it in one range", () => {
    expect(firstRanges("epub", 100_000, 60_000)).toEqual([{ start: 0, end: 99_999 }]);
  });

  it("asks a PDF for its head and its tail, a small one for all of it", () => {
    expect(firstRanges("pdf", 300 * MB)).toEqual([
      { start: 0, end: PDF_HEAD_BYTES - 1 },
      { start: 300 * MB - PDF_TAIL_BYTES, end: 300 * MB - 1 },
    ]);
    expect(firstRanges("pdf", PDF_HEAD_BYTES + PDF_TAIL_BYTES)).toEqual([{ start: 0, end: PDF_HEAD_BYTES + PDF_TAIL_BYTES - 1 }]);
  });

  it("asks a MOBI for its header and a plain FB2 for the whole file", () => {
    expect(firstRanges("azw3", 2 * MB)).toEqual([{ start: 0, end: MOBI_HEAD_BYTES - 1 }]);
    expect(firstRanges("mobi", 1000)).toEqual([{ start: 0, end: 999 }]);
    expect(firstRanges("fb2", 2 * MB)).toEqual([{ start: 0, end: 2 * MB - 1 }]);
  });

  it("asks for nothing without a usable size", () => {
    expect(firstRanges("epub", 0)).toEqual([]);
    expect(firstRanges("pdf", Number.NaN)).toEqual([]);
    expect(firstRanges("pdf", -1)).toEqual([]);
  });
});

describe("prefetchScript", () => {
  /** Runs the page's script against a fake window; the fetches answer as `respond` says */
  function run(script: string, respond: (range: string) => { status: number; bytes?: number }) {
    const requests: string[] = [];
    const workers: string[] = [];
    const window: Record<string, unknown> = {
      Promise,
      fetch: vi.fn(async (_url: string, init: { headers: { Range: string } }) => {
        requests.push(init.headers.Range);
        const { status, bytes = 4 } = respond(init.headers.Range);
        return { status, arrayBuffer: async () => new ArrayBuffer(bytes) };
      }),
      Worker: class {
        constructor(url: string) {
          workers.push(url);
        }
      },
    };
    // The context is the page's global object: the script calls fetch and Worker on it
    window.window = window;
    runInNewContext(script, window);
    return { window, requests, workers };
  }

  it("starts every range at once and keeps the ones that arrived", async () => {
    const script = prefetchScript({
      fileId: "f1",
      url: "/api/ebooks/files/f1",
      ranges: [
        { start: 100, end: 199 },
        { start: 0, end: 9 },
      ],
    });
    const { window, requests, workers } = run(script, (range) => (range === "bytes=100-199" ? { status: 206, bytes: 100 } : { status: 500 }));
    expect(requests).toEqual(["bytes=100-199", "bytes=0-9"]);
    const got = await (window[PREFETCH_GLOBAL] as Record<string, Promise<{ start: number; bytes: ArrayBuffer }[]>>).f1;
    expect(got.map((g) => [g.start, g.bytes.byteLength])).toEqual([[100, 100]]);
    expect(workers).toEqual([]);
  });

  it("accepts a whole-file answer only for a range from the start", async () => {
    const script = prefetchScript({ fileId: "f2", url: "/f", ranges: [{ start: 0, end: 9 }, { start: 50, end: 59 }] });
    const { window } = run(script, () => ({ status: 200 }));
    const got = await (window[PREFETCH_GLOBAL] as Record<string, Promise<{ start: number }[]>>).f2;
    expect(got.map((g) => g.start)).toEqual([0]);
  });

  it("starts the PDF worker once the ranges are in, and only once", async () => {
    const script = prefetchScript({ fileId: "f3", url: "/f", ranges: [{ start: 0, end: 9 }], worker: "/vendor/pdfjs/pdf.worker.min.mjs" });
    const { window, workers } = run(script, () => ({ status: 206 }));
    expect(workers).toEqual([]);
    await (window[PREFETCH_GLOBAL] as Record<string, Promise<unknown>>).f3;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(workers).toEqual(["/vendor/pdfjs/pdf.worker.min.mjs"]);
    expect(window[PDF_WORKER_GLOBAL]).toBeDefined();
  });

  it("leaves a worker the engine already started", async () => {
    const script = prefetchScript({ fileId: "f4", url: "/f", ranges: [{ start: 0, end: 9 }], worker: "/w.mjs" });
    const { window, workers } = run(script, () => ({ status: 206 }));
    window[PDF_WORKER_GLOBAL] = { started: "by the engine" };
    await (window[PREFETCH_GLOBAL] as Record<string, Promise<unknown>>).f4;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(workers).toEqual([]);
  });

  it("escapes < so a URL cannot end the script", () => {
    const script = prefetchScript({ fileId: "f5", url: "/f?</script><script>alert(1)//", ranges: [{ start: 0, end: 1 }] });
    expect(script).not.toContain("</script>");
    expect(script).toContain("\\u003c/script>");
  });
});
