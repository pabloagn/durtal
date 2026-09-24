# Task 0100: Extract Shared Author Filter Logic (DRY)

**Status**: Completed
**Created**: 2026-04-06
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0097
**Blocks**: None

## Overview
Author filtering logic (nationality, gender, zodiac, birth/death year, alive status) is duplicated across 4 files totalling 500+ redundant lines: `getAuthors`, `getAuthorCount`, `getAuthorsForMap`, `getAuthorsForTimeline`. Extract into a shared `buildAuthorFilters()` utility.

## Implementation Details
- Create `src/lib/actions/utils/author-filters.ts` with shared filter builder
- Refactor `src/lib/actions/authors.ts` (getAuthors, getAuthorCount)
- Refactor `src/lib/actions/author-map.ts` (getAuthorsForMap)
- Refactor `src/lib/actions/author-timeline.ts` (getAuthorsForTimeline)
- Same pattern applies to `getVenues`/`getVenueCount` in `src/lib/actions/venues.ts`
- Same pattern applies to `getWorks`/`getWorkCount` in `src/lib/actions/works.ts`
