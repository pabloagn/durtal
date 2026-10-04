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
  view is shown and returns `idle`, `loading`, `error` (with `retry`) or
  `ready`. It keeps the result for the query object the server sent:
  switching views keeps it, while a `router.refresh` (edit dialogs, bulk
  actions) or a new filter sends a new object and loads again. The decisions
  are the pure functions `needsViewLoad` and `viewDataStatus`, tested in
  `src/__tests__/hooks/use-view-data.test.ts`.
- `src/components/shared/view-status.tsx`: the loading line, or an error line
  with a Retry button, for the map and the timelines.
- `src/app/authors/page.tsx`, `authors-shell.tsx`: the page no longer calls
  `getAuthorsForMap` or `getAuthorsForTimeline`. It passes the same search and
  filters as `mapQuery` and `timelineQuery`; the shell loads them with
  `useViewData` and shows `ViewStatus` while loading or after a failure.
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

Review fixes (pre-merge review of PR #7):

- Stale data: the first version cached results by the JSON of the query in a
  ref that was never cleared, so after `router.refresh` an open map or
  timeline kept the old data. Now the result belongs to the query object, and
  a refresh loads again.
- Stuck loader: a failed load was only logged, so the view stayed on
  "Loading...". Now it shows "Could not load the map." (or timeline) with Retry.
- Headless Chrome on `/authors` (map, timeline) and `/library` (timeline):
  `window.next.router.refresh()` loads the view again; a failed server action
  shows the error and Retry loads the data. One load per view, no loop.
  `alignment-audit.js` and `design-audit.js` on the error state at 1440px and
  390px: 0 deviations, 0 low-contrast and 0 unnamed elements.

Checks: `pnpm typecheck`, eslint on the changed files, and
`scripts/qa/test-local.py` (109 files, 1,492 tests) pass.
