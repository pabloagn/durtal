# Task 0340: 44px touch targets on a phone

**Status**: Completed
**Created**: 2026-10-06
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

At 390px with a coarse pointer, 723 controls on the 31 main routes had a
press area under 44 × 44px: card and header menus, favourite stars, sorts,
the Filter button, view switches, the size slider (4px tall), pagination,
the collection switch, section buttons, fields and selects, menu items
(36px), chips' ×, back links and more. Some controls that show on hover
were invisible on a touch screen (location and comment actions, a taxonomy
row's menu). This task brings every control to 44px on touch and keeps the
desktop look as it was.

## Implementation Details

- Three ways, in docs/03 (Keyboard, touch and motion):
  - the control grows on a coarse pointer (`pointer-coarse:min-h-11`,
    `h-11`, `size-11`): `Button` and `buttonClass` (every size), menu items,
    `Input`, `Select`, `DatePicker`, raw fields, the filter row, pagination,
    the collection switch, the settings nav, organization chips, perfume
    formulation links, dialog section toggles and checkbox rows, harmonize's
    own controls (`harmonize.css`);
  - beside text, `CapAligned` / `CapAlignedControls` with
    `coarseHeight={44}` and the control growing with it: the favourite star
    on cards (`CardHeading`, with the star kept at the column's edge), rows
    and headers, the header action menus, the book's marks, carousel arrows,
    location actions;
  - a small mark that keeps its size gets an invisible press area:
    `relative touch-hit`, a new utility in `globals.css` (a centred layer of
    at least 44 × 44px under `@media (pointer: coarse)`): cover chips (the
    copy chip moves left on touch so its area and the menu's do not
    overlap), a taxonomy chip's × (now in `CapAlignedControls`, which does
    not clip), back links, View all, the phone bar's home link, dialog back
    buttons.
- Controls that showed on hover only now also show on a touch screen.
- `scripts/qa/touch-audit.js`: lists every control whose press area (grown
  by a `::before`/`::after` hit layer, cut by any ancestor that clips its
  overflow) is under 44px, with links in running text left out and plain text
  links (a name in a detail list) counted apart.

## Completion Notes

- Preview (`preview-local.py --seed-large 50`), 390 × 844, coarse pointer
  (Chromium and WebKit `isMobile` + `hasTouch`, Firefox
  `ui.primaryPointerCapabilities = 1`), 31 routes: 723 controls under 44px
  before, 77 after the first pass, 6 after the second, 0 now in Chrome,
  WebKit and Firefox. Also 0 in a card's menu (items 44px), the header menu,
  the library's list, detailed, timeline and mosaic views; the book's edit
  dialog leaves two fields cut by the dialog's own scroll edge.
- Text links counted apart: 25 (names and titles in detail lists), out of
  scope.
- Desktop look: `alignment-audit.js` and `design-audit.js` on the 31 routes
  at 1440 and 390 with a fine pointer: no deviation, no nested or unnamed
  control, no sideways scroll. Every change but `relative` on the marks that
  take `touch-hit` and the view switch's centred buttons applies to a coarse
  pointer only.
- Not covered: the media managers' small tile controls (inside a dialog,
  three controls on one thumbnail); their delete stays hover-only there.
