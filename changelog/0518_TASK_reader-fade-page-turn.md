# Task 0518: A Fade page turn

**Status**: Completed
**Created**: 2026-10-14
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0501, 0517
**Blocks**: None

## Overview

SLN-660 asked for one Presentation setting, "Page turn: Slide / Fade /
None". 0501 gave the slide and kept "Instant"; Fade was left. A Fade turn
now crossfades from one page to the next, never through a blank page.

## Implementation Details

- `pageTurn` takes `fade` (`src/lib/validations/reader-preferences.ts`), and
  the settings list it between Slide and Instant
  (`presentation-settings-dialog.tsx`). It is saved per device with the
  other presentation settings; the stored JSON gains a value, so no
  migration.
- `paginatorAttributes` (`src/lib/reader/presentation/layout.ts`) sets the
  renderer's `turn-style` from the setting, `fade` or `slide`, and animates
  for either; the engine no longer pins `turn-style` to `slide`. Reduced
  motion still swaps at once.
- `paginator.js` (VENDORED.md 23): a keyboard, tap or button turn with
  `turn-style="fade"` lays the outgoing page's View Transition snapshot
  over the still incoming page and fades it out over 180 ms. Without View
  Transitions it swaps at once. Finger drags and their settle keep the
  push, as with no layered style; `slide` and `curl` are unchanged.

## Completion Notes

- Checked with the turn's animations paused halfway, in headless Chromium,
  Firefox and WebKit at 1440 and Chromium and WebKit at 390: the fade-out
  runs on the outgoing snapshot in all three. Chromium's capture shows both
  pages blended. Headless WebKit and Firefox captures leave out the incoming
  layer while paused, and do the same for the shipped Slide, so they cannot
  judge it.
- Not covered (the ticket stays open): the same turns for PDFs and comics
  (`fixed-layout.js`), and a jump still fades in from blank.
- Tests: `layout.test.ts` (Fade sets the turn style and animates; reduced
  motion does not).
- No migration and no new packages.
