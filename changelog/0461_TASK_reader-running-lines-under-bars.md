# Task 0461: Running lines no longer show through the reader's bars

**Status**: Completed
**Created**: 2026-10-12
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0460
**Blocks**: None

## Overview

On a 390px phone the book's own footer line ("Learning your pace", the page
and percentage) showed faintly through the glass bottom bar, across the
progress slider. The bars carry the same information, so the book's running
lines now fade out while the bars are up and return with the page.

## Implementation Details

- `ReaderEngine.setMarginaliaHidden(hidden)` keeps the running lines in place
  but at opacity 0, with the bars' 200ms fade (none under reduced motion). The
  foliate engine remembers the state, so lines redrawn on a page turn keep it.
- `reader-view.tsx` passes `bars.visible` to it whenever the bars show or
  hide, or the place changes.
- Both the header and footer lines fade, since the top bar covers the header
  the same way.

## Completion Notes

- Checked in headless WebKit and Chrome at 390 and 430px with touch: with the
  bars up nothing in the book's footer meets the slider and the lines read
  opacity 0; with the bars hidden the lines are back at their usual 0.6. The
  alignment audit is empty with the bars up.
- Test: `reader-view.test.ts` asserts the lines hide while the bars show and
  return after a page turn.
