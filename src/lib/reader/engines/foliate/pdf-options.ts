import { version } from "pdfjs-dist/package.json";

export const PDFJS_VERSION = version;
export const PDF_WORKER_CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'";

/** Installed 6.4.299 ships ICC data. No relative decoder URL reaches a worker. */
export function pdfDocumentOptions(base: string) {
  const url = new URL(base);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== `/vendor/pdfjs/${PDFJS_VERSION}/`
  )
    throw new TypeError("Expected an absolute versioned pdf.js asset base");
  return {
    rangeChunkSize: 262144,
    disableAutoFetch: true,
    disableStream: true,
    // Retained for compatibility. 6.4.299 ignores this input: its display API
    // does not forward it. Worker CSP, not this property, blocks native eval.
    isEvalSupported: false,
    enableXfa: false,
    useWorkerFetch: true,
    cMapUrl: new URL("cmaps/", url).href,
    cMapPacked: true,
    standardFontDataUrl: new URL("standard_fonts/", url).href,
    wasmUrl: new URL("wasm/", url).href,
    iccUrl: new URL("iccs/", url).href,
    canvasMaxAreaInBytes: 67108864,
  } as const;
}
