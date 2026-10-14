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

See the PR for the measurements.
