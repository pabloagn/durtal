# Task 0856: The Add book step bars stay 44px wide on a phone

**Status**: Completed
**Created**: 2026-10-18
**Priority**: LOW
**Type**: Fix
**Depends On**: SLN-947, SLN-952 (task 0845)
**Blocks**: None

## Overview

Found while checking SLN-947 to SLN-952 on main. On a phone the Add book
wizard shows its steps as a row of bars, and each done step's bar opens that
step again. At 320px the six bars were 43px wide, under the 44px touch
target. Since task 0845 the existing-book check is a seventh bar of its own,
and the bars were 36px wide there, in Chromium, Firefox and WebKit.

## Implementation Details

- `step-progress.tsx`: the 6px between bars is now each button's own padding
  (the row pulls out 3px each side, so the bars still start and end on the
  text edges and look the same). Six targets are 48px across 320px.
- Seven 44px targets cannot fit across 320px, so the phone row keeps the six
  steps: the existing-book check shows as part of the step it was run from
  ("Step 2 of 6 — Existing book" after Details). The wider screens keep the
  "Existing book" label in its own place in the row, as task 0845 made it.

## Completion Notes

- New test `src/__tests__/ui/wizard-phone-steps.test.ts` (4 cases).
- The duplicate step and the details step, at 1440, 390 and 320 in
  Chromium, Firefox and WebKit: alignment, design, overflow and touch audits
  find nothing.
