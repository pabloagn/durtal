# Task 0800: Paging a list keeps the focus on the pager

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-852. Focus survey, cause 1 (`findings/focus-survey-2026-10-15.md`).

On any paged list (Books, Films, People and the rest), pressing Next, Previous, First, Last or a page number, Go after typing a page, or changing Per page left the focus on the page body, in every browser. Each list route keys its Suspense by the page, so a new page remounts the list and both pagers, and the focused control went with them.

## Implementation Details
- `src/components/shared/pagination.tsx`:
  - Each control carries `data-pager-control` (first, previous, page-N, next, last, jump, size).
  - Using one notes it, with its pager: the anchor and "overview" (above the list) or "bottom".
  - When the new page's pager of the same name mounts with the focus on the body, the same control takes it back, without scrolling. Enter again keeps paging.
  - A control that is gone (Next on the last page) hands it to its counterpart: Previous for Next and Last, Next for Previous and First.
- Test: `src/__tests__/ui/pagination-keeps-focus.test.ts`.

## Completion Notes
See the PR for the browser checks.
