import type { ReaderFormat } from "./engine";
import { PDFJS_BASE } from "./pdf-assets";
export { PDFJS_BASE } from "./pdf-assets";

/**
 * The first byte ranges of a book (eBooks sub-issue 3), which the page asks
 * for as soon as its HTML arrives, while the engine's code downloads: for a
 * zip (EPUB, FBZ, CBZ) its central directory and its first 64 KiB (where
 * the container, the package document and usually the first chapter sit),
 * for a PDF its first 256 KiB and its last 64 KiB (where the
 * cross-reference table sits when the file is not saved for the web), for
 * MOBI and AZW3 the first 64 KiB, for a plain FB2 the whole file (the engine
 * reads all of it). Every range is
 * explicit (`bytes=a-b`): the size is known from the catalogue, and a
 * simple range needs no CORS preflight.
 */

/** The end-of-central-directory record (22 bytes) and the longest zip comment */
export const ZIP_TAIL_BYTES = 65_557;
export const ZIP_HEAD_BYTES = 64 * 1024;
export const PDF_HEAD_BYTES = 256 * 1024;
export const PDF_TAIL_BYTES = 64 * 1024;
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
  if (format === "pdf") {
    // A small file is one range
    if (size <= PDF_HEAD_BYTES) return [{ start: 0, end: last }];
    return [
      { start: 0, end: PDF_HEAD_BYTES - 1 },
      { start: size - PDF_TAIL_BYTES, end: last },
    ];
  }
  if (format === "mobi" || format === "azw" || format === "azw3") return [{ start: 0, end: Math.min(last, MOBI_HEAD_BYTES - 1) }];
  if (format === "fb2") return [{ start: 0, end: last }];
  return [];
}

/** Where the page leaves its first range for the engine, by file id */
export const PREFETCH_GLOBAL = "__durtalPrefetch";
/** Where scripts/vendor-pdfjs.mjs puts pdf.js's run-time files */
export const PDF_WORKER_URL = `${PDFJS_BASE}pdf.worker.min.mjs`;
/** The pdf.js worker, once started: by the page's script or by the engine, whichever comes first */
export const PDF_WORKER_GLOBAL = "__durtalPdfWorker";
export const PDF_WORKER_CLAIMED_GLOBAL = "__durtalPdfWorkerClaimed";

/**
 * The page's inline script: starts the first ranges at once and leaves the
 * promise of the ones that arrived, `[{ start, bytes }]`, under
 * window.__durtalPrefetch. For a PDF it then starts pdf.js's worker (its
 * script is the largest download a PDF waits for): by then the page's own
 * code has nearly arrived, and the worker downloads while the page starts,
 * not with the engine's code after it. Every value is JSON, with `<`
 * escaped, so nothing ends the script early.
 */
export function prefetchScript(input: { fileId: string; url: string; ranges: ByteRange[]; worker?: string }): string {
  const data = JSON.stringify({ id: input.fileId, url: input.url, ranges: input.ranges, worker: input.worker ?? null, size: Math.max(0, ...input.ranges.map((range) => range.end + 1)) }).replace(
    /</g,
    "\\u003c",
  );
  return `(function(){
var d=${data},w=window,p=w.${PREFETCH_GLOBAL}||(w.${PREFETCH_GLOBAL}={});
if(!w.fetch||!w.Promise)return;
function discard(r){if(r.body)r.body.cancel().catch(function(){});}
function bounded(r,g){
  var length=g.end-g.start+1,expected="bytes "+g.start+"-"+g.end+"/"+d.size;
  var declared=r.headers.get("content-length");
  if(length>262144||r.status!==206||r.headers.get("content-range")!==expected||(declared!==null&&(!/^\\d+$/.test(declared)||Number(declared)!==length))||!r.body){discard(r);return Promise.reject("invalid PDF prefetch range");}
  var reader=r.body.getReader(),bytes=new Uint8Array(length),received=0;
  function release(){reader.cancel().catch(function(){});reader.releaseLock();}
  function pump(){return reader.read().then(function(part){
    if(part.done){if(received!==length)throw "truncated PDF prefetch";return bytes.buffer;}
    if(received+part.value.byteLength>length)throw "oversized PDF prefetch";
    bytes.set(part.value,received);received+=part.value.byteLength;return pump();
  });}
  return pump().then(function(bytes){release();return bytes;},function(error){release();throw error;});
}
p[d.id]=Promise.all(d.ranges.map(function(g){
  return fetch(d.url,{headers:{Range:"bytes="+g.start+"-"+g.end}}).then(function(r){
    if(d.worker)return bounded(r,g);
    if(r.status===206||(r.status===200&&g.start===0))return r.arrayBuffer();
    discard(r);throw r.status;
  }).then(function(b){return{start:g.start,bytes:b}},function(){return null});
})).then(function(a){return a.filter(Boolean)});
if(d.worker&&w.Worker)p[d.id].then(function(){
  if(w.${PDF_WORKER_CLAIMED_GLOBAL})return;
  try{w.${PDF_WORKER_GLOBAL}||(w.${PDF_WORKER_GLOBAL}=new Worker(d.worker,{type:"module"}))}catch(e){}
});
})()`;
}
