# Task 0733: Stats years wrap with a mouse; the chosen year stands out

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0728
**Blocks**: None

## Overview

SLN-821, from the re-check of #375's year row. With a mouse the single
scrolling row of years had no scrollbar and no swipe, so older years were
out of reach; and the chosen year's thin outline was hard to see. With a
mouse the years now wrap; on touch they stay one row that scrolls. The
chosen year is filled.

## Implementation Details

- `src/components/reading/stats-years.tsx`: `pointer-fine:flex-wrap
  pointer-fine:overflow-x-visible` on the row; the chosen year adds
  `bg-bg-tertiary` to its inset ring, a fill of its own, not the tabs'
  selection fill. With every year in view the scroll effect does nothing.
- Test: `src/__tests__/reading/reading-tabs-wrap.test.ts` checks the touch
  and mouse rows and the chosen year's fill.

## Completion Notes

- With 32 years of readings: at 1440 with a mouse the years take two rows,
  all in view, in Chromium, Firefox and WebKit; at 390 and 320 on touch one
  row that scrolls, the chosen year (2026, 2001, 1995, All time) in view.
- Alignment, overflow, layout, touch and design audits are clean in all 36
  runs of Stats. Page weight passes every route.
