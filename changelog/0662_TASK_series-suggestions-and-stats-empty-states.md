# Task 0662: Series suggestions and Stats empty states

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-755. This was finding 7 of the second loading and speed audit (`findings/audit-loading-2-2026-10-15.md`).

- **Series suggestions:** with no books, the page said "every matching book is already in its series", as plain text.
- **Stats:** with no reading, the page said "No reading in 2026" and offered nothing to do.

## Implementation Details

- **Series suggestions** (`series/suggestions/page.tsx`): with nothing to suggest, the page uses the shared empty view and says why, with a next step.
  - **No books:** "No books yet", with Add book.
  - **No series:** "No series yet", with Add series (the Series page's own dialog).
  - **Everything linked:** "No suggestions", with See all series.
  - `getSeriesSuggestionScope` (`src/lib/actions/series.ts`) tells these apart. It is one query, and it runs only when there is nothing to suggest.
- **Stats** (`reading/stats/page.tsx`): the empty view says what makes up the numbers and offers Start a book, as the Reading page's own empty view does. All time with no reading says "No reading yet", not "No reading in all time".

## Completion Notes

- **Browser checks** on the seeded production preview, with its disposable database emptied step by step:
  - Series suggestions showed each of its three views: No suggestions, then No series yet with the series removed, then No books yet with the books removed.
  - Stats with the reading removed showed "No reading in 2026" and, for all time, "No reading yet". Start a book opens the book picker in Chromium, Firefox and WebKit.
- **Audits:** the alignment and design audits found nothing in any of these views at 1440 and 390, in all three engines.
- **Page weight:** every route is within budget (`/reading/stats` 88 of 400 KB).
- `pnpm typecheck` is clean, and ESLint adds no warning on the changed files.
