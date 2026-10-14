# Task 0582: Series and reading titles wrap in full

**Status**: Completed
**Created**: 2026-10-14
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

From the design audit, SLN-641 slice 2, P2 "Series titles". CLAUDE.md:
titles and identifying metadata wrap in full, never clamp.

## Implementation Details

- Series list view (`SeriesListItem`, `src/components/series/series-card.tsx`):
  the title, the original title and the authors were cut to one line
  (`truncate`); they now wrap, breaking only a word wider than the row. The
  grid cards already wrapped.
- Series page, Books (`src/components/series/series-books.tsx`): the book
  titles take the `type-item-title` role (they had the 21px Cirka through
  their row, not the role).
- Reading hub (`src/app/(catalogue)/reading/page.tsx`): the Up Next tiles'
  titles and the suggestions' titles and authors were cut to one line; they
  wrap in full.
- Up Next (`src/components/reading/queue-list.tsx`): the row's title and
  author wrap in full.

The reading stats lists (most re-read, top authors) keep one line: they are
rankings with a value at the end of each line, left to the design contract.

## Completion Notes

Measured on a disposable preview against main, in Chromium (1440, 1024,
390 and 320 with touch), Firefox (1440 and 390) and WebKit (1440, 390 and
320 with touch), with a long series title and a long Up Next title:
- The series list view's long title was one cut line at 390 in all three
  browsers (803px of text in a 234px box). It now takes 4 lines (116px);
  at 1440 it fits on one line, as before.
- The series page's book titles: the same 21px and 28.875px line, now from
  the role.
- The hub and Up Next show the long title in full; those pages grow by the
  title's lines only. 45 other routes measure the same as main.
- Alignment, design, overflow and touch audits: no issue on these pages.
