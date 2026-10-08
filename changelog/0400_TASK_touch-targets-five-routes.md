# Task 0400: Touch targets on the new-record forms and taxonomy pages

**Status**: In Progress
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-550, found by SLN-548. On a coarse pointer, five routes had controls under
44px: on /perfumes/new, /films/new and /paintings/new the "Add …" and
"Unknown" buttons (24px high); on a taxonomy family page the colour picker
(20px) and the item rows' links (24px); on a taxonomy item page the
breadcrumb links (24px). Each is 44px on touch now; mouse sizes are unchanged.

## Implementation Details

- `src/components/catalogue/record-fields.tsx`: `AddButton` takes `touch-hit`
  (a 44px press area, no change to its look or the line). `FieldRow` puts its
  rows (`pointer-coarse:py-1.5`) and its wrapped lines
  (`pointer-coarse:gap-y-2.5`) further apart on touch, so an Add press area
  overlaps no row or line beside it.
- The "Unknown" buttons in `film-fields.tsx`, `perfume-fields.tsx` and
  `painting-fields.tsx` take `touch-hit`.
- `src/components/taxonomy/taxonomy-color-picker.tsx`: the trigger is 44px on
  touch; its popover is 256px wide there, with 44px presets, None, hex field
  and Set.
- `src/components/taxonomy/taxonomy-item-row.tsx`: the row is 44px high on
  touch and the name's link takes the row's height.
- The taxonomy item page's breadcrumb links take `touch-hit`.

## Completion Notes

Paused (credits) before the PR. Done so far, on a preview of main 4214bb77
with the large seed, at 390px with touch:

- The five routes: the touch audit lists nothing in headless Chrome, and no
  two press areas overlap apart from the fixed header over scrolled content
  and the title fields' Capitalize button (as on main).
- The dialogs and popovers that use the changed components (film, perfume and
  painting edit; the row colour picker; New item with and without its picker;
  New family with its picker), in Chrome, Firefox and WebKit at 390px touch
  and 1440px mouse: the changed controls are never listed and overlap
  nothing. What these dialogs still list is on main too and outside this
  task: the credit rows' role selects, move and remove buttons and
  credited-as fields, chips' remove buttons (16px), "Approximate" on dates,
  and New family's scope checkboxes (24px).
- Typecheck clean, lint 0 errors and 75 warnings as on main, deadcode clean.
- `browser-audit.mjs` on 52 routes, stopped part way: Chrome at 1440 and 768
  passed 52 of 52 each, and at 390 the 9 routes it reached passed.

Left: the browser audit on all 52 routes in Chrome (390), Firefox and WebKit
at 1440, 768 and 390; a check that mouse sizes are unchanged against main;
`scripts/qa/test-local.py`; then the PR.
