# Task 0577: Page turns slide in WebKit too

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

With the Slide turn style, a turn that has to load its page first (into a
chapter that is not loaded yet, and every PDF and comic turn) slid the page
in Chromium and Firefox but faded it in WebKit (Safari). It now slides there
too. The leftover of SLN-660.

## Implementation Details

- `src/vendor/foliate-js/page-hold.js` (Durtal patch 26, `VENDORED.md`):
  WebKit holds the whole screen rather than the book, as it leaves a held
  book's new layer blank, and the whole screen also held the reader's bars,
  so the hold faded instead of moving them. The reader's controls
  (`[data-reader-chrome]`) now get layers of their own in WebKit's hold too,
  as they already did in the book hold, and the screen's old or new layer
  slides in the turn's direction with the same shadow and timing.
- WebKit's first hold in a session still fades. It is the one that finds out
  whether the engine runs frames inside the transition, and by then the book
  has already been named.

## Completion Notes

- Turn back into a chapter that is not loaded (scratch script, 1440 px): the
  hold's animation was an opacity fade in WebKit and a slide in Chromium and
  Firefox; now a slide (`translateX`, 250 ms) in all three.
- `reader-engine-check.mjs --only turns`: 12 of 12 (no blank frame during a
  jump or a turn of the EPUB, the text PDF and the comic, at 1440 and 390 px,
  Chromium and WebKit).
- No migration and no new packages.
