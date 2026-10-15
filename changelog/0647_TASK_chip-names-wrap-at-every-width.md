# Task 0647: Chip names wrap at every width, never cut

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0646
**Blocks**: None

## Overview

Review of #335, its "should". Below 640px a record form's chip names wrap
in full (0646), but from 640 up a name over about 50 letters was still cut,
as on main: a long studio, country, movement or house in Edit film, painting
or perfume. Names should never be cut.

## Implementation Details

- `record-fields.tsx`, `CHIP_NAME`: the name wraps in full at every width
  (`min-w-0 whitespace-normal break-words`), no longer cut from `sm` up; on
  touch its lines keep the 44px line's center for the cross, as before.
- `ROLE_CHIP_NAME` builds on `CHIP_NAME`: on touch and below `sm` the name
  still takes a line of its own; elsewhere it wraps beside its menu.
- The house, perfumer and painter role menus are `shrink-0`, so a wrapping
  name never squeezes the menu.
- `film-fields.tsx`: a credit row's name wraps at every width too.
- Test: `src/__tests__/ui/chip-touch-targets.test.ts`.
- 0646's label size read 14px; it is 12px (`type-label`).

## Completion Notes

- Measured on a production preview of a disposable seed database in
  Chromium, Firefox and WebKit: Edit film, painting and perfume, Add copy,
  Add a reproduction and Link a work, with every chip's name set to a
  90-letter name ("Société Nouvelle des Établissements Gaumont et Compagnie
  Cinématographique de Paris et Lyon"):
  - before (main with #335): at 1440 and 1024, 7 names were cut in Edit
    film, 4 in Edit painting and 4 in Edit perfume. At 768 and 640 (touch)
    7 in Edit film and 3 in Edit painting; with a mouse, all 15 at 768 and
    640 in Chromium and Firefox;
  - after: no name is cut at 1440, 1024, 768, 640, 390 and 320, with touch
    below 800 and with a mouse from 768 down. Nothing scrolls sideways, and
    the alignment, touch and overflow audits are clean in every form.
- With the seed's short names at 1440 and 1024, every chip is the same
  height as before (66 of 66 form measurements; one baseline reading was
  taken during the dialog's open animation).
- `page-weight.js` passes. Typecheck clean, lint no errors, UI tests pass
  (104 files). No migration, no new package.
