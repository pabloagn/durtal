# Task 0580: 44px touch targets in the icon picker and on a recommender's website link

**Status**: Completed
**Created**: 2026-10-14
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

From the design audit, SLN-641 slice 2, P2 "Touch targets under 44px".

## Implementation Details

- Collection icon picker (`src/components/collections/icon-picker-panel.tsx`):
  on touch each icon is a 44px button, as many to a row as the panel fits
  (`repeat(auto-fill, minmax(2.75rem, 1fr))`); with a mouse the grid stays 8
  columns of 36px. "Remove" is 44px tall on touch, as tall as the search
  field beside it.
- Recommender page (`src/app/(catalogue)/recommenders/[id]/page.tsx`): the
  website link takes the shared `touch-hit` press area, so the row's layout
  does not change.

## Completion Notes

Measured on a disposable preview against main, with the picker open, in
Chromium and WebKit at 1440 (mouse), 390 and 320 (touch), and Firefox at
1440 and 390:
- On touch the icons are 44px tall and 44.6 to 51.3px wide, 6 or 7 to a
  row (main: 36 by 36, 8 to a row). Remove is 44px tall (main: 28).
- The touch audit inside the open picker: 0 targets under 44px (main: 1,750).
- With a mouse the picker is as on main: 36px icons, 8 to a row.
- The recommender page's website link passes the touch audit at 390 and
  320; its row's layout is unchanged.
- Alignment and overflow audits: no issue.
