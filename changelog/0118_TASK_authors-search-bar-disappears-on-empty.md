# Task 0118: Authors Search Bar Disappears When Nothing Matches

**Status**: Completed
**Created**: 2026-09-24
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: 0121

## Overview

On `/authors`, when a search or filter returns no results, the whole toolbar (search input and filters) disappears. The user cannot edit the query without going back.

## Implementation Details

### Root cause (confirmed in code)

- `src/app/authors/page.tsx:113-125`: `if (rawAuthors.length === 0) return <EmptyState />` returns before `<AuthorsShell>` is rendered (~177-192).
- The search input and filter dropdowns live inside the shell (`authors-shell.tsx:416-435`, input at `components/shared/entity-filters.tsx:74-76`), so they are never rendered.
- The empty-state copy only checks `search`. A filters-only empty result (for example the broken nationality filter, task 0120) wrongly shows "No authors yet / Authors are created when you add books".

### Fix direction

- Always render the shell. Show the "no results" state inside it, below the toolbar, with a "clear filters" action.
- Keep the full-page EmptyState only when the database has zero authors in total.
- Same pattern exists in `src/app/library/page.tsx:92-105`, `src/app/places/page.tsx:58` and `src/app/series/page.tsx:14`. Fix them the same way.

## Completion Notes

Reproduced on a local copy of the live DB. Two symptoms, one root cause:

1. A search or filter with no match removed the search box and filters.
2. A search with matches made the search box lose focus after every search. Letters typed while results loaded could be lost.

The toolbar lived inside the `<Suspense key={params}>` data boundary, so it unmounted on every URL change, and the empty branch returned before it rendered. `/library` never had this bug because its toolbar (`LibraryFiltersBar`) sits outside that boundary.

### Fix

- `/authors`: new `authors-filters-bar.tsx` holds search, sort, filters and view mode. The page renders it in its own Suspense with no key (the filter data does not depend on the URL), so it stays mounted. `AuthorsShell` now renders only the results.
- `/places`: same split (`places-filters-bar.tsx`). The toolbar now offers only grid and list, the two modes the page renders; an old stored "detailed" mode falls back to grid (it used to show a blank page).
- New `src/components/shared/no-results.tsx`:
  - `NoResults`: "No authors found" + "No authors match ..." + a clear link ("Clear search", "Clear filters" or "Clear search and filters"). Sort and order stay.
  - `PageOutOfRange`: shown when `?page=` is past the end, with a link to page 1.
- New `src/lib/utils/list-params.ts`: `clearedListHref()`, `firstPageHref()`, `hasListQuery()`.
- Full-page "No authors yet" / "No venues yet" / "Your library is empty" only show when there is no search and no filter.
- `/library`: filtered empty state now uses `NoResults`, so it gets the clear link too.
- `EntityFilters`: the search input re-syncs with the URL `q` when the input is not focused (after "Clear", back/forward).
- `useLocalStorage` bug found during testing: `setValue` dispatched its sync event inside a React state updater, which runs during render. With two components on the same key (toolbar + results) React logged "Cannot update a component while rendering a different component". `/library` had the same hidden bug. The hook now resolves the value from a ref and dispatches outside render.
- `/series`: no change needed. It has no search or filters; its empty state only shows when there are no series.

### Tests

- `src/__tests__/utils/list-params.test.ts`: 10 tests.
- Browser (local DB copy): no-match search keeps the toolbar and focus; "Clear search" empties the input and keeps sort; back button re-fills the input; filter-only, search + filter and page-past-end messages; all five `/authors` views switch with no React warnings; `/library` and `/places` view switching; `/places` and `/library` no-match states.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (225 tests) and `next build` pass.
