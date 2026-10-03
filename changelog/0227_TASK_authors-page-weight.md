# Task 0227: Load author map and timelines only when shown (SLN-294)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: SLN-419

## Overview

`/authors` loaded the map points and the timeline rows of every matching
author on each request, also in grid view, which shows one page of authors.
`/library` did the same with the timeline rows of every work. Now the map and
the timelines load through their server actions only when that view is open.

## Implementation Details

- `src/lib/hooks/use-view-data.ts`: new hook. It calls a loader only while a
  view is shown, keeps each result in memory by its query key, and returns
  null while loading.
- `src/app/authors/page.tsx`, `authors-shell.tsx`: the page no longer calls
  `getAuthorsForMap` or `getAuthorsForTimeline`. It passes the same search and
  filters as `mapQuery` and `timelineQuery`; the shell loads them with
  `useViewData` and shows "Loading map..." or "Loading timeline..." meanwhile.
- `src/app/library/page.tsx`, `library-shell.tsx`: the same for
  `getWorksForTimeline` (`timelineQuery`). The empty state now depends on the
  paged works only.
- `src/lib/actions/works.ts`: `buildSearchCondition` is wrapped in React
  `cache`, so the list and the count on one page run its ISBN, author,
  publisher and series lookups once.

## Completion Notes

Measured on `next dev` with live data (curl, HTML bytes):

| Page | Before (:3100) | After (:3294) |
|---|---|---|
| `/authors` (grid) | 1,345,808 | 432,844 |
| `/library` (grid) | 869,126 | 530,028 |
| `/authors?q=nadas` | 314,048 | 313,541 |

The issue asked for `/authors` under ~150 KB. The rest is shared by every page:
`/authors?q=nadas`, with one author, is already 313 KB. Most of that is the
photo adjustments and zod, tracked in SLN-385. The 48 grid cards add ~120 KB.

Same data when opened (headless Chrome, server action response vs. the old
embedded data): map 2,029 points before and after, author timeline 674 rows,
books timeline 548 works.

`alignment-audit.js` and `design-audit.js` at 1440px and 390px on `/authors`
(grid, map, timeline) and `/library` (grid, timeline): 0 alignment deviations,
and results identical to the live app. The low-contrast items in the map
attribution and the timeline labels already exist on main.

Checks: `pnpm typecheck`, eslint on the changed files, and
`scripts/qa/test-local.py` (108 files, 1,488 tests) pass.
