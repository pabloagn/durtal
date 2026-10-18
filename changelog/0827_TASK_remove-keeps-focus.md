# Task 0827: Removing a book from a series or collection keeps the focus

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-913, from the series and collections survey
(findings/series-collections-survey-2026-10-16.md, item 2). Pressing Remove on
a series row left the focus on the page body, so the next Tab started again
from the top of the page. On a collection card the focus also fell to the body
while the removal ran, because the pressed button turned disabled.

## Implementation Details

- `src/components/series/series-books.tsx`: the series list joins
  `FocusKeeper` (`data-focus-list="series"`, `data-focus-row` on each row), and
  Add books (`series-actions.tsx`) is where the focus goes once no row is left.
  The rule is the house one: the next row's Remove, else the row before, else
  Add books.
- Remove on a series row and Remove, Move earlier and Move later on a
  collection card are `busy` while they run instead of `disabled`, so the
  pressed button keeps the focus until its row goes. A press on another
  control meanwhile is still ignored by the existing guards.

## Completion Notes

- Checked with keyboard Enter and with a click in Chromium, Firefox and
  WebKit: removing a middle, the last and the first row, down to an empty
  list. The focus moves to the next row's Remove, the row before's, then Add
  books or "Add to the collection"; it never lands on the body, also while the
  removal runs.
- A source test in `busy-focus-leftovers.test.ts` for the series markup.
- Audits clean on a series and a collection page in three browsers at 1440,
  390 and 320; page weight passes.
