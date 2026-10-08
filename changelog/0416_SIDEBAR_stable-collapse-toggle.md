# Task 0416: Stable sidebar collapse toggle (SLN-560)

**Status**: Completed
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
- Production touch QA found that the expanded timer's time button shrank below 44px at narrow custom widths. It now has a 44px minimum touch target; a timer container query hides its decorative cover below 204px of content width on coarse pointers to preserve room for the time, pause and stop controls.
- Long hour clocks keep seconds where they fit; rail and narrow time slots show explicit hours/minutes (`1h00`, `11h59`) to avoid reaching the next control. The accessible name retains the complete book title and duration. Coarse timer text starts at the first line so the larger target does not move its cap alignment.
- The phone drawer retains its labelled links and close control. Reduced motion continues to use the existing global preference.
- The tooltip has a local opt-in for the sidebar toggle's expanded state; existing menu tooltip suppression is unchanged.

## Completion Notes

- Before evidence: desktop rows compressed from 38px to 30px, icon centres moved 3.5px horizontally and the last row moved 150px vertically. Before and production after screenshots are attached to SLN-560 in Linear.
- Source reconciles the landed menu and control changes through main `7fd703a4cd5489adb580c5141b62d679de5337af`; the ancestry reconciliation changed no tracked file. Independent source reviews covered the integration and timer target fixes. The final compact-hour correction is isolated in `f0627ed8b3a5a2c9097a9961dce34c2c976398aa` with five regression cases.
- Production Chrome and WebKit: 16 tall/short, fine/coarse, timer/no-timer geometry cases measured 0px navigation drift during collapse, unchanged row dimensions and stable scroll allocation. Four interaction contexts covered custom resizing and persistence, Settings synchronization, double-click, native Enter/Space and focus, independent tablet preferences, reduced motion (0.01ms), phone navigation and Escape.
- Application validation: 164 route/viewport checks passed alignment within 0.5px, overflow, control overlap and applicable 44px touch targets. The interaction audit passed all four selected routes. WebKit emitted cancelled RSC prefetch messages only during rapid navigation; bounded stable pages had zero runtime errors and zero RSC HTTP errors. Raw messages remain in the evidence.
- Timer validation on the final compiled source: 80 cases across both engines, fine/coarse pointers and widths 56/200/224/228/229px covered 59:59, 1h00, 11h59 and 100h00 with a long title. Text remained within the sidebar and clear of adjacent icons; touch targets stayed at least 44px with no target overlap and a 100px allocation. Wider time slots retained the full clock, including the default fine-pointer 224px sidebar. A forgotten running timer can exceed the 12-hour saving limit, so the 100-hour display is included. Two live timer checks crossed 59:56 → 1h00 with no alignment findings. Four separate compiled checks confirmed 4px bottom padding, 44px target height and zero alignment findings without injected styles.
- Local validation: full `test:local` passed 3,290 tests across 305 files, zero skipped, plus all three Python suites; its disposable container was removed. It ran on the previously approved source before the display-only hour marker correction. The final correction passed 38 focused tests, typecheck and lint (zero errors, 75 existing warnings); database logic is unchanged. Production and Docker builds passed. Final page-weight passed all 30 populated routes; three optional routes had empty fixtures, distinct from the zero-skipped test requirement.
- Exact published-head CI remains pending. Independent final delta approval and the coordinator's explicit merge slot are required before integration. The disposable production preview is stopped and its database removed; shared fixtures and worktree remain available.

Retained evidence includes the full-suite summary, compiled timer boundary/live-hour/padding results, sidebar geometry/interaction report, route matrix, page-weight and build logs.
