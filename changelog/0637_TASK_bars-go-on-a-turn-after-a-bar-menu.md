# Task 0637: The bars go on a turn after a bar's menu, with the mouse still

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0632
**Blocks**: None

## Overview

SLN-786 follow-up, from the Fourth reviewer's review of #380. #380 merged
with the first half of the reviewer's Firefox fix: the bars let go once the
mouse moves over the book. In Firefox, after picking from a bar's menu (Page
colour at 1440, More then Settings at 390 and 320) and turning with the
keyboard while the mouse stays still, the bars still stayed up until the
mouse moved. Now a turn or a scroll sends them away.

## Implementation Details

- `src/components/reader/reader-shell.tsx`: `release()`, which a turn and a
  scroll call, now also lets go of the pointer when the mouse's last place is
  over the book (Firefox sends no leave when a menu closes under it), and
  starts the hide wait when it let go of either focus or the pointer.
  `lastPointer` moves up beside the other refs, and `offBars()` is shared by
  `pointerAt` and `release`.
- The diff is the reviewer's, applied as sent.

## Completion Notes

- `reader-view.test.ts`: the bars test now also turns with the mouse resting
  over the book and expects the bars down at once. It fails on main ("expected
  false to be true") and passes with the fix.
- Typecheck clean; `reader-view`, `reader-bars` and `input` tests pass (62).
- The reviewer's measurements on a production build of the fix: every bars
  case passes in Chromium, Firefox and WebKit at 1440, 390 and 320 (mouse
  with no change, Sepia and Scroll; keyboard Sepia; touch Sepia); after the
  Page colour menu at 1440 and More then Settings at 390, a turn hides the
  bars in all three; `reader-engine-check.mjs` 278 of 278; reader alignment,
  design and overflow audits 54 of 54 clean; `page-weight.js` within budget.
- In WebKit at 1440 the bars stay up after a turn while the mouse still
  rests on the Settings button: the pointer is over the bars, which the
  design allows.
- No migration and no new packages.
