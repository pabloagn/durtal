import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
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
