# Task 1003: The icon picker is one choice with one Tab stop a grid

**Status**: Completed
**Created**: 2026-10-19
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1302, from the widgets and ARIA survey (findings/widgets-aria.md, Medium 12). The collection icon picker drew every Lucide icon as its own `aria-pressed` toggle, so "All icons" was well over a thousand Tab stops for what is one choice, and neither the match count nor "No icons match" was announced.

## Implementation Details

- **`IconGrid`** (`src/components/collections/icon-picker-panel.tsx`) is a `radiogroup` named by its caption ("Suggested", "All icons", or the match count). Each icon is a `radio` with `aria-checked`.
- **One Tab stop a grid:** the chosen icon, else the first. Arrow keys move focus across the rows, and Home and End go to the row's ends. Enter or Space chooses (the buttons' own click). The roving stop moves by setting `tabIndex` on two buttons rather than rendering every icon again; a new list or a new choice resets it.
- **Columns:** the grid's own, read from the layout (8 with a mouse, as many as fit on touch), else 8 before layout. `iconGridMove` holds the movement and is tested on its own.
- **One polite status line** (`role="status"`), there from the first render: empty with no search, then "12 icons" or "No icons match “…”". It replaces the separate count caption and no-match paragraph, with the same look.
- The scrolling area is `tabIndex={-1}`: Firefox otherwise makes it a Tab stop of its own between the search box and the first grid.
- "All icons" now gets one list made once (`EVERY`), so the memoised grid no longer redraws on every keystroke in the search box.

## Completion Notes

- **Keys, on a private preview, in Chromium, Firefox and WebKit at 1440 (mouse) and 390 (touch):** from the search box, Tab goes to Suggested, then All icons, then out, one press each (after Remove when an icon is set). Arrows: Right +1, Down one row (8 columns at 1440; 7 in Chromium and Firefox and 6 in WebKit at 390, as laid out), End the row's last icon, Home its first, Up a row. Space chose the focused icon in each.
- **Alignment audit:** 0 issues with the picker open, with no search, a search ("book", 36 icons) and no match, in the three browsers at 1440, 390 and 320. The panel stays inside the viewport at each width.
- **Tests:** new `src/__tests__/collections/icon-picker-keys.test.ts` (happy-dom): one Tab stop a grid on the chosen icon, arrow, Home and End movement, the status line present before its text changes and naming the match count and no match, and `iconGridMove` at the edges.
- `pnpm typecheck` clean. `page-weight.js`: /harmonize (pre-existing) and /reading at 1.04 s of 1 s on the scale seed fail; neither uses the picker, and /reading's time is recorded on SLN-1381.
- **Rechecked on main after #609**, with one change: the empty status line was `display: none` (`empty:hidden`), which takes a live region out of the accessibility tree, so a screen reader could miss its first text. It now keeps its place at no height (`empty:mb-0`), and the test checks it is never hidden. A headless pass in Chromium, Firefox and WebKit at 1440, 390 and 320: one Tab stop a grid (the chosen icon when one is set, after Remove), arrows by the laid-out columns (8 at 1440; 7 or 6 at 390; 6 at 320), Home and End to the row's ends, Space chooses, "36 icons" for "book" and "No icons match" for no match, the empty line still `display: block` at 0 px, the panel inside the viewport, and 0 alignment issues open, searched and with no match.
