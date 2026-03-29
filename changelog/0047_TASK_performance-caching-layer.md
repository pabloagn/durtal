# Task 0047: Performance & Caching Layer

**Status**: Completed
**Created**: 2026-03-29
**Priority**: HIGH
**Type**: Infrastructure
**Depends On**: None
**Blocks**: None

## Overview

Comprehensive performance overhaul targeting the four main bottlenecks causing sluggish page loads: uncached S3 image redirects, zero data caching, force-dynamic on all pages, and disabled image optimization.

## Implementation Details

### 1. S3 Image Redirect Caching (`src/app/api/s3/read/route.ts`)

- Added in-memory presigned URL cache (50-minute TTL, 1-hour presigned expiry)
- Added `Cache-Control: public, max-age=1800, stale-while-revalidate=3600` headers
- Lazy eviction when cache exceeds 2000 entries
- **Impact**: Eliminates redundant AWS `GetSignedUrl` calls; browser caches images for 30 minutes

### 2. Taxonomy/Reference Data Caching (`src/lib/cache.ts`)

- Created centralized cache utility with `cached()` wrapper around `unstable_cache`
- Created `CACHE_TAGS` constants for consistent tag-based invalidation
- Created `invalidate()` helper for busting caches after mutations
- Wrapped all taxonomy queries (11 functions) with 1-hour cache:
  - `getWorkTypes`, `getSubjects`, `getGenres`, `getTags`, `getCategories`
  - `getThemes`, `getLiteraryMovements`, `getArtTypes`, `getArtMovements`
  - `getKeywords`, `getAttributes`
- Wrapped reference queries: `getLocations`, `getRecommenders`
- Added `invalidate()` calls to all taxonomy/location/media mutations
- **Impact**: Book detail page (16 parallel queries) now serves 13 from cache

### 3. Removed `force-dynamic` from All Pages

Removed from 11 pages:
- `src/app/page.tsx` (dashboard)
- `src/app/library/page.tsx` (library grid)
- `src/app/library/[slug]/page.tsx` (book detail)
- `src/app/authors/page.tsx`, `src/app/authors/[slug]/page.tsx`
- `src/app/series/page.tsx`, `src/app/series/[id]/page.tsx`
- `src/app/locations/page.tsx`, `src/app/tags/page.tsx`
- `src/app/library/collections/page.tsx`, `src/app/collections/page.tsx`

Added `invalidate(CACHE_TAGS.works)` to `createWork`, `updateWork`, `deleteWork`.
Added `invalidate(CACHE_TAGS.works, CACHE_TAGS.media)` to all media mutations.

### 4. Enabled Next.js Image Optimization (`next.config.ts`)

- Set quality to 85 (preserves poster quality while optimizing file size)
- Enabled AVIF + WebP format negotiation
- Set `minimumCacheTTL: 3600` for optimizer cache
- Removed `unoptimized` from all 5 components using Next.js Image:
  - `book-card.tsx`, `page.tsx` (dashboard), `author-detail-header.tsx`
  - `authors/[slug]/page.tsx`, `create-collection-dialog.tsx`
- **Impact**: Images served at exact viewport size with automatic format negotiation

## Files Modified

- `src/lib/cache.ts` (new)
- `src/app/api/s3/read/route.ts`
- `src/lib/actions/taxonomy.ts`
- `src/lib/actions/locations.ts`
- `src/lib/actions/recommenders.ts`
- `src/lib/actions/works.ts`
- `src/lib/actions/media.ts`
- `src/components/books/book-card.tsx`
- `next.config.ts`
- 11 page files (removed `force-dynamic`)

## Completion Notes

No new infrastructure required (no Redis, no CDN). All performance gains come from:
- Browser-level HTTP caching (Cache-Control headers)
- Next.js Data Cache (unstable_cache with tag-based invalidation)
- Next.js Image Optimization (automatic resize + format negotiation)
- Removing force-dynamic to let Next.js cache page renders
