# Task 0375: On a narrow list, an Up Next row's buttons go under the text

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-539, found while checking 0372 (#154). On a phone, an Up Next row
(`/reading/next`) put the handle, the place, the cover, "Start reading" and
the row menu on one line, and left the text about 25 px (10 px in Firefox).
The title showed as "U..." and the line under it wrapped one word per row.

## Implementation Details

All in `src/components/reading/queue-list.tsx`:

- The list (`ol`) is a size container, and each row is a grid: the handle,
  the place, the cover and the text, then the buttons.
- When the list is 34rem (544 px) wide or more, the buttons take a fifth
  column beside the text, centered on the title's cap height as before. The
  row looks as it did.
- On a narrower list, the buttons go on a second row under the text, at its
  left edge. There they are a plain row, 32 px high (44 px on a touch
  screen), not centered on a text line: `CapAlignedControls` gets
  `@max-[34rem]:` classes that take its height and negative margins away.

## Completion Notes

- Production builds of main (3d121289) and this branch on the newest
  backup. The backup's Up Next is empty, so the preview's database (local,
  thrown away after) got three books in Up Next, as in 0372. Headless Chrome,
  Firefox and WebKit at 1440 px with a mouse, and at 768 and 390 px with a
  coarse pointer:
  - 1440 px: every part of each row has the same position and size before
    and after, to 0.01 px, in all three browsers.
  - 768 px: the list is 662 px wide (647 px in Firefox), so the row keeps one
    line; the same before and after.
  - 390 px: the text went from 25 px wide (10 px in Firefox, where the title
    was cut) to 192 px (177 px in Firefox). The line under the title takes 2
    or 3 rows, not 11 to 14. "Start reading" and the menu sit under the text,
    44 px high, with no negative margin.
  - The alignment, design and overflow audits find nothing at any width.
    At 390 px the touch audit and the press-area overlap check find nothing.
    `page-weight.js` passes.
- Not changed here, and the same on main: at 768 px with a coarse pointer,
  the touch audit finds 20 targets under 44 px in the sidebar (the logo,
  Search and the navigation links).
- Typecheck clean. Lint: no new warning. `pnpm deadcode` clean.
- `scripts/qa/test-local.py`: 262 files, 2,953 tests, all passed.
