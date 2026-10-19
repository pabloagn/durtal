import { cdnOrigin } from "@/lib/reader/csp";

/**
 * The Content-Security-Policy of the catalogue's pages (SLN-1240), the second
 * layer behind sanitizing stored HTML: only the app's own scripts run, each
 * carrying the request's nonce (src/proxy.ts puts it on the request, and
 * Next.js on its scripts). Pictures may come from any https address: map
 * tiles and markers, covers and portraits found by a lookup. The authors map
 * talks to Mapbox; the address picker loads Leaflet's stylesheet. An e-book's
 * page reads its bytes and cover from the e-book CDN when EBOOK_CDN_URL is set.
 */

const MAPBOX = ["https://api.mapbox.com", "https://*.tiles.mapbox.com", "https://events.mapbox.com"];

export function catalogueCsp(nonce: string, options: { development?: boolean; cdnUrl?: string } = {}): string {
  const cdn = cdnOrigin(options.cdnUrl);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${options.development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://unpkg.com",
    "img-src 'self' blob: data: https:",
    "font-src 'self' data:",
    `connect-src ${["'self'", ...MAPBOX, ...(cdn ? [cdn] : [])].join(" ")}`,
    "frame-src 'self' blob:",
    "worker-src 'self' blob:",
    "media-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
}
