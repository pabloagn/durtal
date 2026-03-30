# Task 0053: Book Card Three-Dots Menu Overlap and Style Fix

**Status**: Not Started
**Created**: 2026-03-30
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
The three-dots action menu that appears on hover over a book card in grid view overlaps with the rating indicator. Additionally, the round shape of the three-dots container looks off. Both issues need to be fixed for a cleaner presentation.

## Implementation Details
- Reposition the three-dots menu button so it does not overlap with the rating display
- Change the container shape from round to something more aligned with the design system (2px border radius, squared)
- Ensure the menu button is visually clean and unobtrusive
- Test with cards that have ratings and those without
- Verify no overlap with other card elements (labels, badges)
