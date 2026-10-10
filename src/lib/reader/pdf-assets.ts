import { version } from "pdfjs-dist/package.json";

export const PDFJS_VERSION = version;
export const PDFJS_BASE = `/vendor/pdfjs/${PDFJS_VERSION}/`;
/** Native JavaScript eval remains forbidden; pdf.js's PostScript WASM is allowed. */
export const PDF_WORKER_CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'";
