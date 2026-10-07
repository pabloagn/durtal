# Task 0366: Small tap targets, the table's copy button and the cover placeholder letter

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Small touch and alignment problems found by review and the merging thread:
three tap targets under 44 px on a touch screen (SLN-523), the copy button in
the `/library` table view off its title's line (SLN-529), and the cover
placeholder letter's contrast and name for screen readers (SLN-522). Nothing
else changes on the page.

## Implementation Details

- **SLN-523, tap targets.**
  - "Adjust collection poster" on each collection card (`collection-card.tsx`)
    was 28 by 28 px on touch. It takes `touch-hit`, as the edition card's
    adjust button already does. The shared `ImageAdjustButton` is not changed,
    so its other places keep their layout.
  - The 404 page's "Go to dashboard" (`src/app/not-found.tsx`) was 38 px tall.
    It takes `pointer-coarse:min-h-11`, as every `Button` does.
  - "Configure columns" in the table view's header (`data-table.tsx`) was a
    bare 14 px icon. A drawn press area would be cut by the table's scrolling
    box (`overflow-x-auto` also clips vertically), so on touch the button
    itself is 44 px and its cell drops its padding there. With a mouse
    nothing moves.
- **SLN-529, the table's copy button.** The title cell centered the copy
  button on the row; a book with a rare or poison mark has a second line under
  its title, so the button sat 10 px off the title. The button now sits in a
  column that repeats the text's lines: the first line holds it, cap-aligned
  (`CapAlignedControls`, which keeps its press area whole), and an invisible
  copy of the marks keeps the same height. The title, cover and marks do not
  move.
- **SLN-522, the placeholder letter.** The large letter of a book card with no
  cover (`CoverPlaceholder`, `book-card.tsx`) and the small one in the table
  view are decoration: both are `aria-hidden`, so a screen reader no longer
  reads a stray letter before the title. `scripts/qa/design-audit.js` skips
  text hidden from screen readers in its contrast check, as it skips disabled
  text.

## Completion Notes

- Production builds of main (707f5bf7) and this branch, each served on the
  newest backup with every cover served (9 collections with a poster, 124
  rare or poison books), in headless Chrome (with the hover and fine pointer
  flags for mouse runs), WebKit and Firefox, at 1440 and 768 px with a mouse
  and 390 px with a coarse pointer. Pages: the four `/library` views (grid,
  mosaic, list, table), `/` and a 404 page.
  - Before: the table view's copy button 10.09 px off its title in Chrome and
    Firefox, 9.99 px in WebKit, on 5 rows at every width; at 390 px, "Configure
    columns" 14 by 14 px, "Adjust collection poster" 28 by 28 px four times on
    `/`, and "Go to dashboard" 160 by 38 px.
  - After: `alignment-audit.js`, `design-audit.js` and `touch-audit.js` find
    nothing on any page in any browser at any width, and no two `touch-hit`
    areas overlap.
- Typecheck clean. Lint: no new warning. `pnpm deadcode` clean.
- `scripts/qa/test-local.py`: 252 files, 2,812 tests, all passed.
