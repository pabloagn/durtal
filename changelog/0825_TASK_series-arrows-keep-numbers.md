# Task 0825: Series arrows no longer rewrite volume numbers

**Status**: Completed
**Created**: 2026-10-16
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-912, from the series and collections survey
(findings/series-collections-survey-2026-10-16.md, item 1). The up and down
arrows on a series page reordered books by writing their volume numbers.
With one unnumbered book a press renumbered every book 1, 2, 3; otherwise it
swapped two numbers, so moving a 2.5 made it 3; with equal numbers it did
nothing.

## Implementation Details

- The arrows are gone from the series page (`series-books.tsx`), and
  `moveSeriesWork` is removed from `src/lib/actions/series.ts`, so nothing
  writes a number except the number field itself.
- The order stays number, then title, with unnumbered books last. Changing a
  book's number is how the order changes.
- Each row keeps Read (when the book has an e-book) and Remove, 8px apart on
  touch, as the touch-spacing rules ask.
- docs/04 states the order and that nothing rewrites a number.

## Completion Notes

- Books that share a number, or have none, can no longer be put in another
  order than their titles'. A later improvement could add a nullable
  `works.series_order` tiebreak (one migration) and bring back arrows only
  among such books; deferred because migrations cannot reach the live
  database yet and 0089 is already waiting.
- `series.test.ts` checks the order with equal and missing numbers and that
  setting one number leaves every other as typed.
- Audits clean on a six-book series (equal, decimal and missing numbers, a
  94-letter title, two e-books) in Chromium, Firefox and WebKit at 1440, 390
  and 320; Read and Remove start on the title's edge on a phone. Page weight
  passes.
