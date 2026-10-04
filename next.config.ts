import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Scope hoisting in `next build` ran the merged db schema modules twice, so
    // drizzle saw two copies of tables like `works` and could not pair their
    // relations (500 on author pages). `next dev` never hoists.
    turbopackScopeHoisting: false,
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
