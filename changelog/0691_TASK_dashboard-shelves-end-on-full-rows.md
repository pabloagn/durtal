# Task 0691: Dashboard shelves end on full rows

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0680
**Blocks**: None

## Overview

Follow-up to the dashboard's front page (0680, #349): Recent additions showed
8 cards, which left 3 alone on a second row at 1440. Every card shelf now ends
on a full row, at whatever column count the width gives.

## Implementation Details

- `src/components/shared/phone-pair-grid.tsx`: `fullRowAttributes(count)`
  says, for each column count `catalogue-grid` makes on the dashboard (2 to
  6), how many cards would sit alone on a last row (`data-rem-5="3"`). A
  shelf no longer than one row keeps all its cards.
- `src/styles/globals.css` (`full-rows`): container queries on the grid's
  own bands (N columns from N x 208px plus the gaps) hide those last cards
  with `:nth-last-child`. On a phone's touch screen, Compact's two columns
  from 328px use the two-column rule; the other bands do not apply there.
  No wrapper around the cards, so they still stretch to their row.
- `src/app/(catalogue)/page.tsx`: shelves take 10 (`SHELF`): two full rows
  at five columns (1440), full rows at two, eight at four, nine at three.
  Recent people keeps its 12. `getLibraryStats({ shelf })`; `/api/stats`
  keeps 8.
- Docs: `docs/03_DESIGN_LANGUAGE.md` (Book cards),
  `docs/04_ROUTES_AND_VIEWS.md` (Dashboard).

## Completion Notes

Measured in Chromium, Firefox and WebKit at 1440, 1280, 1024, 900, 768, 390
and 320: no shelf ends on a partial row. `/` is 249 of 300 KB on the
synthetic catalogue with 20 demo books (229 before: two more books in two
shelves); the merging thread should re-measure it on the newest backup.
