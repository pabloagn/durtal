# Task 0570: Notes opened from a link stand on their own page

**Status**: Completed
**Created**: 2026-10-14
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Following a link to notes outside the reading order showed the notes in the
right half of a spread, after the last page of the chapter before, and a
quarter second later the reader's footer named that chapter and its last
page instead of "Outside the reading order". The reader check's
`navigation` rows failed on main because of it, and the `pointer` link row
passed only by catching the notes for a moment. Separately, Settings opened
from the More menu (below 400px) left keyboard focus on the page when it
closed, and the `dialogs` check could not reach Settings there.

## Implementation Details

- `src/vendor/foliate-js/paginator.js`: `getStripNeighbourIndex` gives no
  neighbour for a nonlinear section. The jump's keep set, the fill of a
  short spread, the scroll preloads and `#fillVisibleArea` use it, so the
  notes are the only section loaded and start on the left page. Turns out of
  the notes still use the adjacent linear section, as a jump that retires
  the notes (VENDORED 15). VENDORED.md entry 27.
- `src/components/reader/side-panel.tsx`: the drawer takes its focus origin
  from `captureFocusOrigin`, which keeps the menu's button beside the item,
  and gives focus back to the button when the item went with its menu.
- `presentation-settings-dialog.tsx`: the quiet Reset button's label starts
  at the settings column's text edge (it sat 10px in, found by the alignment
  audit with Settings open).
- `scripts/qa/reader-engine-check.mjs`: the `dialogs` check opens Settings
  from the More menu when the bar has no room for it, and expects focus back
  on More. A new `pointer` row waits for the page to settle after a link to
  the notes and asserts the place is still in the notes, since the old row
  passed by catching the notes for a moment.

## Completion Notes

- Reader checks `navigation`, `pointer` and `dialogs`: 42 of 42 in Chromium,
  WebKit and Firefox. On main, `navigation` failed at every width in all
  three browsers and `dialogs` could not run Settings.
- `paginator-reading-order.test.ts` and `side-panel.test.ts` add a test each;
  the side panel one fails without the fix.
- Alignment, design and overflow audits are clean on the notes view and with
  Settings open, in all three browsers at 1440, 390 and 320 (18 of 18).
- No migration and no new packages.
