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

- Series list (`src/components/series/series-card.tsx`): the title and the
  original title wrapped nowhere (`truncate`); they now wrap, breaking only a
  word wider than the row.
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

See the PR for the measurements.
