import type { MetadataRoute } from "next";

/** The personal catalogue and its files are not for search-engine indexes. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
