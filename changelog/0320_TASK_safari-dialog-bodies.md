# Task 0320: Safari Dialog Bodies Collapse (SLN-443)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
In Safari, the body of every dialog collapsed to a sliver: only the header
and the first line showed, and the action buttons were out of reach. Chrome
and Firefox showed the whole body. Found during the three-browser check of
SLN-373 (Harmonize, "Review merge").

## Implementation Details
`src/components/ui/dialog.tsx`: the body was `min-h-0 flex-1 overflow-y-auto`
inside the `<dialog>`, a flex column whose height is set only by the
browser's default max-height. `flex-1` gives the body a 0% flex basis;
Safari keeps it there, Chrome and Firefox grow it to its content. The body is
now `flex-auto` (basis auto): it starts from its content, and with `min-h-0`
a tall body still shrinks to the dialog's max-height and scrolls inside it.

## Completion Notes
Measured on Harmonize, "Review merge", 1440x938: Safari dialog 142px with a
44px body before, 484px with a 386px body after; Chrome 488px before and
after. See the PR for the dialogs checked in Chrome, Safari and Firefox.
