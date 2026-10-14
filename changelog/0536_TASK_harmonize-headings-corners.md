# Task 0536: Harmonize page, shared heading roles and 4px corners

**Status**: Completed
**Created**: 2026-10-14
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-694, from the design audit (SLN-641 slice 1, finding P3, map item 8).
The /harmonize page set its headings' type in its own stylesheet instead of
the shared `type-*` roles, and gave its boxes, fields and buttons 2px
corners where the design allows 4px for controls and cards.

## Implementation Details

`src/app/(catalogue)/harmonize/workspace.tsx` and `harmonize.css`:

- The page title "Harmonize." takes `type-page-title`. The finding's title
  ("Possible duplicate", "Missing poster"), the empty states, Activity's
  "A record of your decisions" and the merge dialog's record name take
  `type-section-title`. The blocks inside a finding ("Choose the record to
  keep", "Reconcile the details", "Give this image a place", "A decision
  only you can make") take `type-item-title`. Their font rules leave the
  stylesheet; their margins stay.
- Every 2px corner is `var(--radius-sm)`, 4px. When the batch bar sits
  under the workspace, the two read as one box, rounded at its outer
  corners only.
- The confirmation buttons (Review merge, Confirm merge, Apply fixes,
  Confirm change and a finding's own fix) were light text on the steel
  accent, 1.65:1. They take the
  shared primary colours, `action-fg` on `action-fill`, as `Button` does.

`scripts/qa/touch-audit.js`: a modal dialog or open popover is in the top
layer, so the page around it cannot clip it. The audit's clip walk now ends
there. Before, it cut the merge dialog's buttons at 320px to the part over
the page's scrolling review pane (20px tall), when on screen they are 44px.

## Completion Notes

Measured in headless Chromium, Firefox and WebKit at 1440, 390 and 320 px
(touch below 800 in Chromium and WebKit), on main and on this branch, in
8 states: the inbox, an artwork finding of each kind, a duplicate with its
record choice and reconcile, the merge confirmation, Dismissed and
Activity. 72 renders each.

- Alignment, design, overflow and touch audits: empty on all 72 renders.
  On main the design audit failed the confirmation buttons' contrast in 27.
- Corners: 1,009 boxes at 2px on main; all 4px now (the dialogs' 6px kept).
- The roles' own line heights differ slightly from the page's old ones:
  section titles 38px instead of 33px, item titles 28.9px instead of
  27.3px, the page title 52px instead of 51.5px. The page grows by 1 to 9px,
  and at 320 "Missing edition cover" wraps onto a second line. The page
  title is in `fg-heading`, as every page title is.
- /harmonize page weight: 121 KB, 97 ms.
