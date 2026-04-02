import { unstable_cache } from "next/cache";
import { revalidateTag } from "next/cache";

// ── Cache tags ─────────────────────────────────────────────────────────────────
// Centralised tag names so invalidation is consistent across the codebase.

export const CACHE_TAGS = {
  // Reference/taxonomy data (rarely mutated, safe to cache aggressively)
  workTypes: "ref:work-types",
  subjects: "ref:subjects",
  genres: "ref:genres",
  tags: "ref:tags",
  categories: "ref:categories",
  themes: "ref:themes",
  literaryMovements: "ref:literary-movements",
  artTypes: "ref:art-types",
  artMovements: "ref:art-movements",
  keywords: "ref:keywords",
  attributes: "ref:attributes",
  locations: "ref:locations",
  recommenders: "ref:recommenders",
  countries: "ref:countries",
  authors: "ref:authors",

  // Entity data (mutated more frequently)
  works: "data:works",
  editions: "data:editions",
  series: "data:series",
  collections: "data:collections",
  media: "data:media",
  activity: "data:activity",
  comments: "data:comments",
} as const;

// ── Cache durations (seconds) ──────────────────────────────────────────────────

/** Reference data: 1 hour — taxonomy tables change very rarely */
const REF_TTL = 3600;

// ── Cached wrapper factory ─────────────────────────────────────────────────────

/**
 * Wrap a server-side data-fetching function with Next.js `unstable_cache`.
 * Returns a new function that serves from the Data Cache on subsequent calls
 * until the TTL expires or the tag is explicitly revalidated.
 */
export function cached<T>(
  fn: () => Promise<T>,
  keyParts: string[],
  tags: string[],
  ttl = REF_TTL,
): () => Promise<T> {
  return unstable_cache(fn, keyParts, { revalidate: ttl, tags });
}

// ── Revalidation helpers ───────────────────────────────────────────────────────

/**
 * Invalidate one or more cache tags after a mutation.
 * Wrapped in try-catch: cache invalidation must never break data operations.
 */
export function invalidate(...tags: string[]) {
  for (const tag of tags) {
    try {
      revalidateTag(tag, { expire: 0 });
    } catch {
      // Silently ignore — stale cache is acceptable, broken mutations are not.
    }
  }
}
