# Task 0108: Add Missing Suspense/Loading Boundaries

**Status**: Completed
**Created**: 2026-04-06
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0097
**Blocks**: None

## Overview
Several detail pages with heavy data fetching lack Suspense boundaries, causing blank screens during server-side data loading.

## Implementation Details
Pages missing Suspense + Spinner fallback:
- `src/app/library/[slug]/page.tsx` — Work detail (heaviest page: 15+ parallel fetches)
- `src/app/authors/[slug]/page.tsx` — Author detail
- `src/app/series/[id]/page.tsx` — Series detail
- `src/app/places/[slug]/page.tsx` — Venue detail
- `src/app/reader/[calibreId]/page.tsx` — Reader detail
- `src/app/library/collections/page.tsx` — Library collections

For each, wrap the async content in a Suspense boundary with the standard Spinner fallback pattern used by other pages.
