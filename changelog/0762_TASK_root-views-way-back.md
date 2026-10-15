# Task 0762: The root's own views word their way back as the app does

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0619
**Blocks**: None

## Overview

SLN-814, from the third loading and error states survey
(`findings/survey-loading-3-2026-10-15.md`, item 5): the app-wide error view's
Try again should be the primary button. #376 (task 0619) already did that,
through its review fix, and made Try again reload the page. What was left:
- The app-wide error view's way back said "Go to dashboard", while every
  in-app view says "Go to the dashboard".
- The app-wide not-found view, shown for an address outside the app's
  sections, said the same, in the old fallback button style.

## Implementation Details

- **`src/app/global-error.tsx`**: "Go to dashboard" becomes "Go to the
  dashboard".
- **`src/app/global-not-found.tsx`**: its only way back says "Go to the
  dashboard", in `buttonClass("secondary")`, as the in-app not-found view's
  does.
- `routeFallbackActionClass` stays as it was. The reader's not-found view
  still uses it, and that view belongs to the eBook reader's own work
  (SLN-818).
- **Test**: `loading-audit-states.test.ts` checks the label, address and
  style of both views' way back.

## Completion Notes

- Typecheck is clean, and the error view tests pass.
- No migration, no new package.
