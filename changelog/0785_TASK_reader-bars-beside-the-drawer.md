# Task 0785: The reader's bars stand beside an open drawer

**Status**: Completed
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-892, from the mid-width survey of 16 Oct (finding 5). From 1024px a
drawer (Reading settings, Contents, Search, Highlights and notes) stands
beside the book, which insets out of its way (SLN-728). The top and bottom
bars did not: with Reading settings open, every tool button from "Make
available offline" to "Full screen", the page count, the percent, Go to and
Header and footer lay under the drawer, so a change of font size or margins
could not be judged on the page count. In the font grid, "Atkinson
Hyperlegible" takes two lines, so its row stood taller than the others.

## Implementation Details

- `side-panel.tsx` publishes the inset it already gave the book as two CSS
  properties on the root, `--reader-inset-left` and `--reader-inset-right`
  (removed when no drawer stands beside the book). Below 1024 the drawers stay
  modal, over the book, and nothing is set.
- `globals.css`: a new `inset-x-reader` utility reads them (0 by default). The
  top bar, the bottom bar and its progress line, the top fade, the chapter
  line shown while the bars are hidden, search's results bar and the read
  aloud player use it in place of `inset-x-0`.
- `reader-toolbar.tsx`: the bar chose its compact, narrow and tiny layouts by
  media queries on the screen. It now chooses them by its own width, the
  screen less the drawers beside it, at the same 640, 400 and 360px. One
  drawer at 1024 leaves 664px and the whole bar; a drawer on each side leaves
  304px and the bar moves its other controls into More.
- `font-picker.tsx`: `auto-rows-fr`, so every row of tiles is as tall as the
  tallest and the name still shows in full.

## Completion Notes

- Chromium, Firefox and WebKit, Reading settings open at 1024x768, 1180x820
  and 1440x900: both bars end at the drawer's edge, no bar control lies under
  the drawer or outside its bar, and neither bar's row overflows. With Contents
  open too at 1024 (304px between the drawers) and 1440, the same holds.
- 768x1024 and 390x844: unchanged; the drawer and the sheet lie over the
  book and the bars, as designed.
- Font tiles: 40px rows and one 58px row before; every tile 58px now.
- 0 alignment, design and overflow findings with the drawer open at 1024,
  1180, 1440 and 390 in all three engines, and no console errors.
- Tests: `bars-beside-drawer.test.ts` (the properties follow the drawers from
  1024 and never below; the toolbar keeps its controls beside one drawer and
  moves them into More between two; every fixed strip uses the utility; the
  font grid's rows).
- No migration and no new packages.
