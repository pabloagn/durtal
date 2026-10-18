# Task 0814: Edit work's Recommended by list has a name

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0757 (SLN-850)
**Blocks**: None

## Overview
SLN-850 follow-up. #455 landed without its review fix, so the open "Recommended
by" list in Edit work pointed `aria-labelledby` at `edit-recommender-label`, an
id nothing carried, and Chromium named the list "".

## Implementation Details
- `work-form.tsx`: the "Recommended by" label sits above the chosen chips,
  outside the Select, so it carries `${id("recommender")}-label`, the id the
  Select's list is labelled by.
- `accessible-names.test.ts` pins the label's id.

## Completion Notes
- The fix is the fifth reviewer's `findings/review-455-fix.diff`, applied as is.
