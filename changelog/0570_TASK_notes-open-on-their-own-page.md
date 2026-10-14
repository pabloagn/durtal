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
- `scripts/qa/reader-engine-check.mjs`: the `dialogs` check opens Settings
  from the More menu when the bar has no room for it, and expects focus back
  on More.

## Completion Notes

See the PR for the checks.
