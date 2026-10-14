# Task 0561: A back turn after a Contents jump ends the chapter before

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0517
**Blocks**: None

## Overview

SLN-673 follow-up, found in review. After a jump from Contents or Go to,
one back turn could skip a chapter: on The Ordinary Year (30 chapters of
eight pages), Chapter 2 then Chapter 4 and one Left went to the end of
Chapter 2, not Chapter 3. Right then went straight back to Chapter 4, so
Chapter 3 was never shown.

## Implementation Details

- Cause: a jump to a section that is not loaded kept every loaded view
  within two sections of it. Chapter 2 was kept on the jump to Chapter 4
  without Chapter 3, so the strip read Chapter 2, Chapter 4, and the back
  turn scrolled into Chapter 2's last page.
- `src/vendor/foliate-js/paginator.js` (`#goTo`): it keeps only the loaded
  views that run unbroken up to the target, at most two on each side, in
  reading order (VENDORED.md 24).
- `scripts/qa/reader-navigation-checks.mjs`: `checkJumpBack`, run by
  `reader-perf.mjs` after the navigation assertions (it needs the large
  fixtures): Chapter 2 then 4, and 4 then 6, then one back turn must land in
  the section before.

## Completion Notes

- `checkJumpBack` fails on main ("A back turn from Chapter 4 went to
  section 1") and passes with the fix in headless Chromium, Firefox and
  WebKit.
- Jumps 2, 4, 6, 8, then back to 5 and 3, and 8, 6, 10, 4: each Left lands
  on the last page of the section before, in all three browsers at 1440.
- `reader-engine-check.mjs --only navigation,direction,place,opens`: 135 of
  141 on this branch, 133 of 141 on main, with the same failures in this
  environment (history Back at 390 in Chromium, the notes footer in Firefox
  and WebKit, Firefox's left-to-right direction and saved place).
