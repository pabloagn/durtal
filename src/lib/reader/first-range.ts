import type { ReaderFormat } from "./engine";

/**
 * The first byte ranges of a book (eBooks sub-issue 3), which the page asks
 * for as soon as its HTML arrives, while the engine's code downloads: for a
 * zip (EPUB, FBZ, CBZ) its central directory and its first 64 KiB (where
 * the container, the package document and usually the first chapter sit),
 * for a PDF its first 256 KiB, for MOBI and AZW3 the first 64 KiB, for a
 * plain FB2 the whole file (the engine reads all of it). Every range is
 * explicit (`bytes=a-b`): the size is known from the catalogue, and a
 * simple range needs no CORS preflight.
 */

/** The end-of-central-directory record (22 bytes) and the longest zip comment */
export const ZIP_TAIL_BYTES = 65_557;
export const ZIP_HEAD_BYTES = 64 * 1024;
export const PDF_HEAD_BYTES = 256 * 1024;
export const MOBI_HEAD_BYTES = 64 * 1024;

const ZIP_FORMATS = new Set<ReaderFormat>(["epub", "kepub", "fbz", "cbz"]);

export interface ByteRange {
  start: number;
  /** Inclusive */
  end: number;
}

export function firstRanges(format: ReaderFormat, size: number, cdOffset?: number | null): ByteRange[] {
  if (!Number.isSafeInteger(size) || size <= 0) return [];
  const last = size - 1;
  if (ZIP_FORMATS.has(format)) {
    const known = cdOffset != null && Number.isSafeInteger(cdOffset) && cdOffset >= 0 && cdOffset < size;
    const tail = { start: known ? cdOffset : Math.max(0, size - ZIP_TAIL_BYTES), end: last };
    // A small file is one range
    if (tail.start <= ZIP_HEAD_BYTES) return [{ start: 0, end: last }];
    return [tail, { start: 0, end: ZIP_HEAD_BYTES - 1 }];
  }
  if (format === "pdf") return [{ start: 0, end: Math.min(last, PDF_HEAD_BYTES - 1) }];
  if (format === "mobi" || format === "azw" || format === "azw3") return [{ start: 0, end: Math.min(last, MOBI_HEAD_BYTES - 1) }];
  if (format === "fb2") return [{ start: 0, end: last }];
  return [];
}

/** Where the page leaves its first range for the engine, by file id */
export const PREFETCH_GLOBAL = "__durtalPrefetch";

/**
 * The page's inline script: starts the first ranges at once and leaves the
 * promise of the ones that arrived, `[{ start, bytes }]`, under
 * window.__durtalPrefetch. Every value is JSON, with `<` escaped, so nothing
 * ends the script early.
 */
export function prefetchScript(input: { fileId: string; url: string; ranges: ByteRange[] }): string {
  const data = JSON.stringify({ id: input.fileId, url: input.url, ranges: input.ranges }).replace(/</g, "\\u003c");
  return `(function(){var d=${data},w=window,p=w.${PREFETCH_GLOBAL}||(w.${PREFETCH_GLOBAL}={});if(!w.fetch||!w.Promise)return;p[d.id]=Promise.all(d.ranges.map(function(g){return fetch(d.url,{headers:{Range:"bytes="+g.start+"-"+g.end}}).then(function(r){if(r.status===206||(r.status===200&&g.start===0))return r.arrayBuffer();throw r.status}).then(function(b){return{start:g.start,bytes:b}},function(){return null})})).then(function(a){return a.filter(Boolean)})})()`;
}
