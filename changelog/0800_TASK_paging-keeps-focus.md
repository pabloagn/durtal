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
  - The new page opens at the list's top, so the pager above the list takes the focus when it shows the used control or a stand-in; else the pager below does. Enter again keeps paging.
  - A control that is gone (Next on the last page) hands it to its counterpart: Previous for Next and Last, Next for Previous and First. A hidden control is skipped; the phone's page jump hands it to the "N / M" button.
- Test: `src/__tests__/ui/pagination-keeps-focus.test.ts`.

## Completion Notes
Browser checks (review, Chromium, Firefox and WebKit at 1440, 390 and 320, 120 films at 48 a page): bottom Next lands on top Next, onscreen, and Enter again lands on top Previous on the last page; top Next stays on top Next; bottom Last lands on top Previous; the phone jump, from either pager, and desktop Go land on the top "N / M" button; Per page keeps its select (the bottom one on a phone, where only it shows); a bottom page number keeps it (the top has none); a mouse click shows no ring.
