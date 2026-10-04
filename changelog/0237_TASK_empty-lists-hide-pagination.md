# Task 0237: Empty Lists Hide Their Count, Pagination and Page Size (SLN-402)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: LOW
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview
A list with no items showed "Showing 0–0 of 0", the Previous / 1 / 1 / Next
controls and the "Per page" select around its empty message. An empty list
now shows its empty state alone.

## Implementation Details
- `src/components/shared/pagination.tsx`: `Pagination` renders nothing when
  `total` is 0. Every list page that uses it (directly or through
  `PaginatedSection`) gets this.
- `src/app/reader/reader-library.tsx`:
  - No books and no search: the page header and an `EmptyState` only. The
    search field is hidden.
  - A search with no result: the search field stays, and the shared
    `NoResults` shows "No books found" with a "Clear search" link
    (`clearedListHref("/reader", …)`).
- `src/components/shared/no-results.tsx`: the "Clear" and "Go to first
  page" actions are links styled with `buttonClass`. Before, a `<Button>`
  sat inside a `<Link>`, and the design audit reported one nested
  interactive element on every no-result page.
- `/library`, `/authors` and `/publishers` already returned `NoResults` or
  `EmptyState` before any pagination when the total is 0. They are unchanged.

## Completion Notes
- Typecheck, ESLint on the changed files, unit tests and the full DB suite
  (`scripts/qa/test-local.py`) pass.
- Checked in the browser at 1440×900: `/reader` with no books shows only
  the header and the empty state. `/reader`, `/library`, `/authors` and
  `/publishers` searches with no result show "No … found", a "Clear search"
  link and no pagination. `/publishers` with 258 items still shows
  "Showing 1–48 of 258 publishers" above and below the grid.
- `alignment-audit.js` and `design-audit.js` on those five pages: 0
  alignment issues, 0 low-contrast texts, 0 unnamed controls, 0 nested
  interactive elements, 0 off-token colors.
