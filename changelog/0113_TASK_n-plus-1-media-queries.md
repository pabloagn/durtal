# Task 0113: Fix N+1 Media Queries in Timeline/Map Actions

**Status**: Completed
**Created**: 2026-04-06
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0097
**Blocks**: None

## Overview
`getAuthorsForMap`, `getAuthorsForTimeline`, and `getWorksForTimeline` each perform per-entity media lookups (1 query per author/work) instead of batch-loading via JOINs. For 200 authors, this means 200+ extra DB queries.

## Implementation Details
- `src/lib/actions/author-map.ts` — batch load author posters in single query, then map by authorId
- `src/lib/actions/author-timeline.ts` — same pattern
- `src/lib/actions/work-timeline.ts` — same pattern
- Use `db.select().from(media).where(inArray(media.authorId, authorIds).and(eq(media.isActive, true)))` pattern
- Similar issue in `getLibraryStats` for recent author media lookup (line ~802)
