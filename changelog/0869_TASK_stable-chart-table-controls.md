# Task 0869: Keep chart table controls stationary

**Status**: In Progress
**Created**: 2026-10-17
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: SLN-884 browser acceptance

## Overview

SLN-980: after keyboard chart exploration, pointer-down on Show as table blurs
the chart. Its longer summary wrapped the shared flex row and moved the target
before pointer-up. The preserved 390px diagnosis shows a 265px leftward and
24px downward move on both baseline 385241a3 and statistics candidate 066087e4.

## Implementation Details

- Give the shared ChartFrame caption a shrinkable grid column and the toggle
  its own top-aligned, right-hand column. Long words wrap within the caption;
  the button stays on one line. Existing 44px coarse-pointer targets remain.
- Preserve the focus/blur handlers, full caption, polite live region, keyboard
  navigation and table markup. No pointer suppression or delayed blur.
- This affects WrittenChart on the dashboard and statistics page, BarChart on
  reading/statistics pages, and CalendarHeatmap on reading statistics.
- Add mounted coverage for short/long/empty captions, the real blur before
  pointer-up, first click show/hide, table data, keyboard steps and live text.
  The DOM fixture does not fabricate geometry: actual bounds need a browser.

## Validation

Source only, based on reviewed main 385241a375126b4ae1a023f806b604e782c8f805.
No tests, typecheck, build, database or browser checks have run for this patch.
Next: focused mounted suites and full typecheck, then normal production build
and pointer/keyboard geometry checks across Chromium/Firefox/WebKit at
320/390/430px, tablet and desktop, plus unchanged alignment/design/page-weight
checks. Re-run SLN-884 acceptance after review. No publication or live changes.
