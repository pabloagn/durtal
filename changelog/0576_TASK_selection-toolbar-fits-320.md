# Task 0576: The selection toolbar fits a 320 px phone

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

On a touch screen the selection toolbar docks at the bottom as one row:
five highlight colours, Add a note, Look up and More. At 320 px the row
needed 308 px in a 256 px space, so its end scrolled and Look up started
partly off screen (274 to 318 px in a toolbar that ends at 312). Every
control is now whole at 320 px. SLN-678.

## Implementation Details

- `src/components/reader/selection-toolbar.tsx`, docked row: the colour
  swatches may give up width when the row is short, down to 32 px each and
  always 44 px tall, so Note, Look up and More keep their full 44 px. The
  row still never wraps and still scrolls if a narrower screen ever needs
  it. Wider phones are unchanged: the swatches stay 44 px wide at 390 px.

## Completion Notes

- Measured with the toolbar open on a selection (scratch script, touch
  emulation), Chromium and WebKit:
  - 320 px: swatches 34 px (Chromium) and 32 px (WebKit), Note, Look up
    and More 44 px, nothing clipped and nothing left to scroll (content
    256 of 256 px in Chromium, 250 of 250 px in WebKit).
  - 390 px: every control 44 px, as before.
- Alignment audit and design audit on the reader with the toolbar open, at
  320 and 390 px in both engines: no issues.
- Firefox has no touch emulation, so it shows the floating toolbar, which
  this change does not touch.
- No migration and no new packages.
