# Task 0571: In scroll mode Space keeps a line; switching flow keeps the place

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

The rest of SLN-674. The wheel and the arrow keys already scroll natively in
the scroll flow (0501). Space, Page Down, Shift+Space and Page Up still
jumped a whole screen, so the line at the bottom went out of sight, and
switching from pages to the scroll flow could land up to three screens away
from the page being read.

## Implementation Details

- `src/lib/reader/engines/foliate/engine.ts`: in the scroll flow a page turn
  passes the paginator a distance. Going forward, the last line wholly on
  screen comes to the top; going back, the first comes to the bottom. The
  engine probes the text block at the edge (`elementFromPoint` in the frame,
  then that block's line boxes), stepping past a cut line or a gap between
  blocks. With no text there (an image) it scrolls a screen less the text's
  line height. Never less than half a screen. Left and right follow the
  book's direction as before.
- `src/vendor/foliate-js/paginator.js` (VENDORED 28): the flow switch
  scrolled to the anchor while the views still had the old flow's size, so
  the scroll was clamped short and the next settle took that spot as the
  place. Two frames later, once the views have grown, it scrolls to the same
  anchor again unless a navigation or a scroll replaced it.
- `src/__tests__/reader/scroll-screen.test.ts`: what the engine asks the
  renderer for on each turn, paginated and scrolled, left to right and right
  to left.

## Completion Notes

See the PR for the browser measurements.
