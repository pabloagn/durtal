# Task 0728: Reading tabs wrap whole words on a phone

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-800. On a phone the Reading tab row (Now, Up next, Journal, Notes,
Stats, Suggestions, Import) scrolled sideways and cut a word at each end:
"Stat" on Now, Up next and Journal, "low" for Now when Stats was chosen,
and Suggestions out of sight. The row now wraps, so every tab shows whole.
Design-polish pass three, item 3 (findings/design-polish-3-2026-10-15.md).

## Implementation Details

- `src/components/reading/reading-tabs.tsx`: the row is `flex flex-wrap
  gap-1`; each tab keeps its label on one line (`whitespace-nowrap`). The
  effect that scrolled the current tab into view is gone with the scroller.
- `src/components/reading/stats-years.tsx` (new): the Stats year row stays
  one row that scrolls sideways, as before, with the chosen year kept in
  view: a long record holds dozens of years, which would wrap to seven to
  nine rows on a phone (review of #375). Its chips are smaller and quieter
  than the tabs (14px type against 16px, 28px tall, the chosen year outlined, not
  filled), so the two rows read apart. The row is pulled out by a chip's
  padding so a year's text starts on the page's edge, and it snaps to whole
  years; a chosen year out of view starts the row.
- Test: `src/__tests__/reading/reading-tabs-wrap.test.ts` renders the tabs
  and checks the row wraps and each label stays whole (it fails on main),
  and that the years scroll in smaller chips than the tabs.

## Completion Notes

- Headless Chromium, Firefox and WebKit at 1440, 390 and 320 (touch at 390
  and 320), on all eight Reading pages: no tab or year outside the screen,
  no row that scrolls, equal 4px gaps. The tabs take one line at 1440, two
  at 390 and three at 320; tabs are 44px tall on touch.
- Alignment, overflow, layout, touch and design audits are clean in all 72
  runs. Page weight passes every route.
- With 32 years of readings (1995 to 2026): the year row stays one line in
  all three engines at every width, the chosen year (2026, 2001, 1995, All
  time) is always in view and the first visible year's text starts on the
  page's edge. Audits clean in all 45 runs of the Stats and Now pages.
- Review (findings/review-pr-375.md): choosing one of the last years
  scrolled the row only as far as it goes, so it began partway through a
  year (18px off at 320 in WebKit). It now begins on a whole year, adding
  the little room that takes after the last one. Applied as the reviewer
  wrote it, with its test `src/__tests__/reading/stats-years-scroll.test.ts`.
