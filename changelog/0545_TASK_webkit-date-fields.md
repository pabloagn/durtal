# Task 0545: Date fields centred in Safari on the recovery page

**Status**: Completed
**Created**: 2026-10-14
**Priority**: LOW
**Type**: Fix
**Depends On**: 0541 (SLN-692)
**Blocks**: None

## Overview

On Settings, Reading, eBooks (the reading history recovery list, SLN-692), WebKit drew the Started and Finished dates high in their fields: 2.5px above centre with a mouse, 7px on a touch screen. The text inputs and Chromium and Firefox were centred.

## Implementation Details

- The cause is `display: block` on a native date input. WebKit then lays out its inner date fields from the top of a box taller than one line.
- The recovery page's fields were the only date inputs with `block`. `Input` (inline-block) and the mark date in `mark-toggle.tsx` (a flex item) were already centred.
- `reader-history-recovery.tsx`: the field style uses `flex` in place of `block`, and a fixed `h-8` (`h-11` on touch) like `Input`, in place of a minimum height.

## Completion Notes

- Headless WebKit and Chromium, with a mouse and a touch screen, measured on a date field beside a text field with the same style. The date digits are now 1 to 1.5px below the box centre in both engines, the same as `Input`'s own date fields. Before, WebKit had them 2.5px above (mouse) and 7px above (touch).
