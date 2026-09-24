# Task 0099: Add Missing Cache Tags for Venues and Places

**Status**: Completed
**Created**: 2026-04-06
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0097
**Blocks**: None

## Overview
`CACHE_TAGS` in `src/lib/cache.ts` is missing tags for `venues` and `places` — both are first-class entities with CRUD server actions but no cache invalidation. This means stale data can be served after mutations.

## Implementation Details
- Add `venues: "ref:venues"` and `places: "ref:places"` to `CACHE_TAGS` in `src/lib/cache.ts`
- Wrap `getVenues`, `getVenueCount`, `getVenue`, `getVenueBySlug`, `getFavoriteVenues` in `cached()` calls
- Add `invalidate(CACHE_TAGS.venues)` to `createVenue`, `updateVenue`, `deleteVenue`
- Wrap `searchPlaces`, `getPlaceHierarchy` in `cached()` calls
- Add `invalidate(CACHE_TAGS.places)` to `createPlace`, `getOrCreatePlaceChain`

## Test Evidence
- `src/__tests__/cache/tags.test.ts` — "should have a tag for venues" FAILED
- `src/__tests__/cache/tags.test.ts` — "should have a tag for places" FAILED
