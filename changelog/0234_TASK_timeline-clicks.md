# Task 0234: A click on a timeline opens the book or the author

**Status**: Completed
**Created**: 2026-10-04
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-413. On the book timeline (`/library`, timeline view) a mouse click on a book marker did nothing, and on the author timeline a click on a bar did nothing. Enter on a focused marker or bar worked. The canvas took the pointer (`setPointerCapture`) on every press, to pan, and Chrome then sent the click to the canvas instead of the marker or bar. The zoom buttons and the minimap track sit inside the canvas, so a real mouse press on them was taken the same way.

## Implementation Details
- `src/components/timeline/use-timeline-transform.ts`:
  - A press records where it starts. The canvas takes the pointer only once the press moves more than 3px: a drag. Until then the click stays with the marker or bar under it.
  - The click that ends a drag opens nothing: a capture-phase click handler on the canvas swallows that one click. The next press clears it, so a drag the browser cuts short (`pointercancel`) never swallows a later click.
  - A press on a control inside the canvas (a button, a link, a field, or the minimap, `role="scrollbar"`) is left to it.
- `src/__tests__/ui/timeline-clicks.test.ts` (new, happy-dom): a click on a marker opens it and the canvas does not take the pointer; a drag pans 50px and the click that ends it on a marker opens nothing, and the next click does; presses on a button and the minimap are left to them; a cancelled drag swallows nothing. The code before the fix fails 3 of the 4.

## Completion Notes
Real mouse input (Chrome DevTools `Input` events, so pointer capture behaves as for a person) on `scripts/qa/preview-local.py` (2026-10-04 backup), both timelines, 1440x900 and 390x844:

| Check | `/library` timeline | `/authors` timeline |
|---|---|---|
| Click on a book marker / author bar | opens *Vathek* | opens Plato |
| Drag of 80px that starts and ends on it | pans 80px, opens nothing | pans 80px, opens nothing |
| Zoom in button | zooms (an item 312px from the center moves to 353px) | zooms (272px to 313px) |
| Click at 90% of the minimap | jumps from 1800 to 2011 | jumps from 414 BC to 1802 |
| Enter on a focused marker / bar | opens it | opens it |

- Before: a click on a marker or bar did nothing (the issue's evidence, a dev server on `main`). The new test fails 3 of 4 on the code before the fix.
- `scripts/qa/alignment-audit.js`: 0 rows over 0.5px on both timelines at both widths (31 and 27 rows checked at 1440px). `scripts/qa/design-audit.js`: 0 low-contrast texts, 0 nested controls. No console errors.
- `pnpm typecheck`, `pnpm lint` (0 errors) and `python3 scripts/qa/test-local.py` (1,615 tests) pass.
- `scripts/qa/page-weight.js`: 9 of 10 routes pass; `/library` is 313 KB against its 300 KB budget. It is the same on `main` (321 KB on the live app); this task changes no server HTML.
