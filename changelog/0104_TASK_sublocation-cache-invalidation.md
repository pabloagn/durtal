# Task 0104: Fix SubLocation Cache Invalidation

**Status**: Completed
**Created**: 2026-04-06
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0097
**Blocks**: None

## Overview
Create, update, and delete operations on sub-locations in `src/lib/actions/locations.ts` do not invalidate the parent location cache. Users see stale sub-location data until the cache TTL expires.

## Implementation Details
- Add `invalidate(CACHE_TAGS.locations)` to `createSubLocation`, `updateSubLocation`, `deleteSubLocation`
- All three functions are in `src/lib/actions/locations.ts` (lines ~70-107)
