# Task 0609: A not-found view's way back looks like a button

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0603
**Blocks**: None

## Overview

From the main audit of 15 October (finding 5). A not-found view's only
action, such as "Go to the dashboard" or "Back to books", was a ghost link:
secondary text with no fill or border, so it read as plain text. The layout
audit flagged it as a plain-looking command in all 9 runs.

## Implementation Details

- The eight catalogue not-found views (the catch-all and the books, people,
  films, paintings, perfumes, publishers and organizations ones) draw their
  way back with `buttonClass("secondary")`, the look of the error views' Try
  again. On an error view the way back stays ghost, beside Try again.
- `global-not-found.tsx` (the fallback outside the app shell) and the
  reader's own view keep their own styles.

## Completion Notes

- `src/__tests__/ui/error-views.test.ts`: each of the eight files leads back
  with the secondary look and none with the ghost one.
- Measured in the browser: see the PR.
