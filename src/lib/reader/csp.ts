/**
 * The Content-Security-Policy of the reader's pages (eBooks sub-issue 3).
 * A book is untrusted HTML: its sections are blob and srcdoc frames, which
 * inherit this policy, so a script inside a book never runs. The app's own
 * scripts carry the request's nonce (Next.js reads it from the policy that
 * src/proxy.ts puts on the request). Bytes and covers may come from the
 * e-book CDN when EBOOK_CDN_URL is set.
 */

export const READER_PAGE_RE = /^\/reader\//;

/** A fresh nonce: 16 random bytes, base64 */
export function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/** The CDN's origin, or null when it is not set or not a URL */
function cdnOrigin(cdnUrl: string | undefined): string | null {
  if (!cdnUrl) return null;
  try {
    const url = new URL(cdnUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function readerCsp(nonce: string, options: { development?: boolean; cdnUrl?: string } = {}): string {
  const cdn = cdnOrigin(options.cdnUrl);
  const withCdn = (...sources: string[]) => (cdn ? [...sources, cdn] : sources).join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${options.development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' blob:",
    `img-src ${withCdn("'self'", "blob:", "data:")}`,
    "font-src 'self' blob: data:",
    `connect-src ${withCdn("'self'")}`,
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
}
