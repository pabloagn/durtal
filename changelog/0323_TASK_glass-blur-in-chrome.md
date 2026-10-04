# Task 0323: Glass blur in Chrome

**Status**: Completed
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-445. Every glass surface had no blur in Chrome, other Chromium browsers (Helium, Arc) and Firefox: menus, dialogs, the command palette, tooltips, the top bar, the card chips and the veil. Safari blurred as designed. This is the "no blur" Pablo saw on the cards (SLN-435).

## Implementation Details
- Cause: `src/styles/globals.css` wrote `backdrop-filter` first and `-webkit-backdrop-filter` second, with the same value. Lightning CSS, which compiles the CSS in Turbopack (dev and build), reads the second line as an override of the first and drops the standard line. Chrome and Firefox have no `-webkit-backdrop-filter`, so their computed `backdrop-filter` was `none`. The local preview runs `next dev --webpack`, which keeps both lines, so it did not show the fault.
- Fix: the prefixed line comes first in the four pairs (`glass::before`, `glass-bar::before`, `glass-chip`, `glass-veil`). In that order Lightning CSS keeps both.
- Guard: `src/__tests__/glass-surfaces.test.ts` checks that each standard `backdrop-filter` in `globals.css` has the prefixed line just before it, and none after it.
- Docs: `docs/03_DESIGN_LANGUAGE.md`, Glass.
- No other prefixed property in the CSS collapses this way: the `-webkit-` lines in `globals.css` and `harmonize.css` (font smoothing, line clamp, user drag, touch callout) have no standard twin before them, and the served stylesheet keeps them.

## Completion Notes
- Before, on localhost:3100 (main d6d0981, Turbopack dev): computed `backdrop-filter` of a card mark, a card button, `glass`, `glass-bar` and `glass-veil` was `none` in Chrome and in Firefox on all five; Safari blurred them as designed.
- `pnpm build` with the fix: the stylesheet has both lines for every surface: `glass` and `glass-bar` (24px), `glass-chip` (10px, or `--glass-chip-blur`), `glass-veil` (6px).
- That build, served with `preview-local.py --start`, at 1440 and 390px: computed `backdrop-filter` is `blur(3px) saturate(1.8) brightness(0.6)` on a cover mark, `blur(10px) …` on a card button, `blur(24px) saturate(1.5) brightness(0.3)` on `glass` and `glass-bar`, `blur(6px) saturate(1.2)` on `glass-veil`, in Chrome, Safari and Firefox. Nothing injected: the chips are the page's own, and the three surfaces are bare elements with their classes.
- A hovered card in Chrome, before and after: the chips over the cover now frost what lies behind them.
- `glass-surfaces.test.ts`: 6 tests pass; the full suite passes.
