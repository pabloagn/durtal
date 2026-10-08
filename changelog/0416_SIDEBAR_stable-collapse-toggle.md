# Task 0416: Stable sidebar collapse toggle (SLN-560)

**Status**: In Progress
**Created**: 2026-10-08
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Add a visible, accessible collapse control and keep sidebar navigation geometry and scrolling stable while labels hide and the width changes.

## Implementation Details

- The sidebar toggle and resize-handle double-click share the same preference operation as Settings → Display. Cookies preserve the last custom expanded width, the desktop choice and an independent explicit expansion override for the 768–800px tablet rail.
- Search and navigation keep one fixed icon column, 38px mouse rows, 44px touch rows and 2px navigation gaps. Label visibility preserves the line boxes. Cap-height alignment and color-only row transitions avoid icon movement during the width transition.
- The footer keeps its allocation in both states. A running timer reserves 100px in either layout, and narrow expanded widths use its rail layout. The rail's time button is also a full 44px target.
- The phone drawer retains its labelled links and close control. Reduced motion continues to use the existing global preference.
- The tooltip has a local opt-in for the sidebar toggle's expanded state; existing menu tooltip suppression is unchanged.

## Completion Notes

- Read-only before evidence: rows compressed from 38px to 30px; icon centres moved 3.5px horizontally and the last row moved 150px vertically. Original screenshots attached to Linear.
- Focused tests: 25 passed across sidebar preference/focus/persistence, palette focus and reading timer suites. Typecheck passed. Lint passed with zero errors and 75 existing warnings.
- Lightweight static browser fixture using the actual sidebar, timer, tooltip and stylesheet: 0px geometry drift during transitions at 1000px and 480px heights, with/without a timer; unchanged scroll allocation; no alignment findings. Both fine and coarse pointer rows preserve their dimensions. Tablet expansion returns from 56px to 224px.
- Headless native Enter and Space activate the toggle and retain focus; Escape closes its tooltip. Reduced motion measures a 0.01ms transition. Changed production-file lint has one existing shell effect warning and zero errors.
- Pending the coordinated heavy validation slot: full zero-skipped `pnpm test:local`, production and Docker builds, disposable DB-backed preview on port 3423, full application alignment/page-weight/overflow/touch/interaction checks and after evidence. Independent review and an explicit merge slot are required before integration.
