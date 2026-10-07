import type { ReaderFormat } from "./engine";

/**
 * The first byte range of a book (eBooks sub-issue 3), which the page asks
 * for as soon as its HTML arrives, while the engine's code downloads: for a
 * zip (EPUB, FBZ, CBZ) its central directory, for a PDF its first 256 KiB,
 * for MOBI and AZW3 the first 64 KiB, for a plain FB2 the whole file (the
 * engine reads all of it). Every range is explicit (`bytes=a-b`): the size
 * is known from the catalogue, and a simple range needs no CORS preflight.
 */

/** The end-of-central-directory record (22 bytes) and the longest zip comment */
export const ZIP_TAIL_BYTES = 65_557;
export const PDF_HEAD_BYTES = 256 * 1024;
export const MOBI_HEAD_BYTES = 64 * 1024;

const ZIP_FORMATS = new Set<ReaderFormat>(["epub", "kepub", "fbz", "cbz"]);

export interface ByteRange {
  start: number;
  /** Inclusive */
  end: number;
}

export function firstRange(format: ReaderFormat, size: number, cdOffset?: number | null): ByteRange | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  const last = size - 1;
  if (ZIP_FORMATS.has(format)) {
    if (cdOffset != null && Number.isSafeInteger(cdOffset) && cdOffset >= 0 && cdOffset < size) {
      return { start: cdOffset, end: last };
    }
    return { start: Math.max(0, size - ZIP_TAIL_BYTES), end: last };
  }
  if (format === "pdf") return { start: 0, end: Math.min(last, PDF_HEAD_BYTES - 1) };
  if (format === "mobi" || format === "azw" || format === "azw3") return { start: 0, end: Math.min(last, MOBI_HEAD_BYTES - 1) };
  if (format === "fb2") return { start: 0, end: last };
  return null;
}

/** Where the page leaves its first range for the engine, by file id */
export const PREFETCH_GLOBAL = "__durtalPrefetch";

/**
 * The page's inline script: starts the first range at once and leaves the
 * promise of `{ start, bytes }` (or null) under window.__durtalPrefetch.
 * Every value is JSON, with `<` escaped, so nothing ends the script early.
 */
export function prefetchScript(input: { fileId: string; url: string; range: ByteRange }): string {
  const data = JSON.stringify({ id: input.fileId, url: input.url, start: input.range.start, end: input.range.end }).replace(
    /</g,
    "\\u003c",
  );
  return `(function(){var d=${data},w=window,p=w.${PREFETCH_GLOBAL}||(w.${PREFETCH_GLOBAL}={});if(!w.fetch)return;p[d.id]=fetch(d.url,{headers:{Range:"bytes="+d.start+"-"+d.end}}).then(function(r){if(r.status===206||(r.status===200&&d.start===0))return r.arrayBuffer();throw r.status}).then(function(b){return{start:d.start,bytes:b}},function(){return null})})()`;
}
