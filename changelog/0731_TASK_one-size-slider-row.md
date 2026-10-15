# Task 0731: One size slider row on every list

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-804. On a phone the card size slider drew its line differently by list:
under the slider on Books and eBooks, beside it on Collections, depending on
how much of the row was left. eBooks also never said how many cards a row,
since its grid was not marked for the slider to measure. Every list now
draws one row, the slider then its line ("Compact", with "· 2 per row" when
there is room). Design-polish pass three, item 7
(findings/design-polish-3-2026-10-15.md).

## Implementation Details

- `src/components/books/grid-size-slider.tsx`: the phone's slider and line
  are always one row (`flex items-center gap-3`, the slider `min-w-11
  flex-1`). The count shows from a 12rem box, the narrow-space note from a
  17rem one, so the line never wraps or squeezes the slider under 44px.
- `src/styles/globals.css`: the slider's box takes the rest of the views'
  row down to 7.5rem (was 4rem), the room "Compact" and a 44px slider need
  side by side; narrower, it takes a row of its own.
- `src/app/(catalogue)/ebooks/ebooks-view.tsx`: the eBooks grid carries
  `data-catalogue-grid` and `data-grid-density`, as the other grids do.
- Test: `src/__tests__/ui/grid-size-slider.test.ts` checks the one row and
  the new thresholds.

## Completion Notes

- Headless Chromium, Firefox and WebKit at 390 and 320 on touch: Books,
  eBooks and Collections all draw the slider with its line beside it. At
  390 Books and eBooks read "Compact" beside the views; at 320 Books and
  eBooks take a row of their own with "Compact · 1 per row · narrow space".
  At 1440 nothing changes ("Size" before the slider).
- Alignment, overflow, layout, touch and design audits are clean in all 36
  runs (Books, eBooks, Collections and Films in grid view). Page weight
  passes every route.
