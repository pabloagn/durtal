import type { NextConfig } from "next";
import { PDFJS_VERSION, PDF_WORKER_CSP } from "./src/lib/reader/pdf-assets";

const nextConfig: NextConfig = {
  output: "standalone",
  // Node PDF inspection needs the native canvas loader and pdf.js's own
  // package-relative worker. Keep both outside server JavaScript bundles.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  // Standalone images copy traced files only. Native optional packages and
  // dynamically read PDF assets must survive both flat and pnpm layouts.
  outputFileTracingIncludes: {
    "/*": [
      "node_modules/@napi-rs/canvas*/**/*",
      "node_modules/.pnpm/@napi-rs+canvas*/node_modules/@napi-rs/canvas*/**/*",
      "node_modules/pdfjs-dist/{package.json,legacy/build/pdf.mjs,legacy/build/pdf.worker.mjs,standard_fonts/**/*,cmaps/**/*,wasm/**/*,iccs/**/*}",
      "node_modules/.pnpm/pdfjs-dist@*/node_modules/pdfjs-dist/{package.json,legacy/build/pdf.mjs,legacy/build/pdf.worker.mjs,standard_fonts/**/*,cmaps/**/*,wasm/**/*,iccs/**/*}",
    ],
  },
  experimental: {
    // Unmatched URLs need their own document when catalogue and reader
    // routes have separate roots. It must not depend on catalogue queries.
    globalNotFound: true,
    // Scope hoisting in `next build` ran the merged db schema modules twice, so
    // drizzle saw two copies of tables like `works` and could not pair their
    // relations (500 on author pages). `next dev` never hoists.
    turbopackScopeHoisting: false,
    // src/proxy.ts runs on the API routes (same-origin check), and Next.js
    // then passes only this much of a request body to the route (default
    // 10 MB). The largest upload is a 50 MB image (MAX_MEDIA_SIZE_BYTES);
    // the rest is room for the other multipart fields.
    proxyClientMaxBodySize: "55mb",
  },
  // The reader's fonts (src/lib/reader/fonts.ts) are loaded by each book's
  // frames: cached, so a section does not ask again. A changed font takes a
  // new file name.
  async headers() {
    return [
      { source: "/fonts/reader/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: `/vendor/pdfjs/${PDFJS_VERSION}/:asset*`, headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      { source: `/vendor/pdfjs/${PDFJS_VERSION}/pdf.worker.min.mjs`, headers: [{ key: "Content-Security-Policy", value: PDF_WORKER_CSP }] },
    ];
  },
  // People were "authors" before SLN-419: every old link and bookmark lands
  // on the same person or list, with its query (308, permanent)
  async redirects() {
    return [
      { source: "/authors", destination: "/people", permanent: true },
      { source: "/authors/:path*", destination: "/people/:path*", permanent: true },
    ];
  },
  images: {
    qualities: [85],
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 3600,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "books.google.com",
      },
      {
        protocol: "https",
        hostname: "covers.openlibrary.org",
      },
    ],
  },
};

export default nextConfig;
