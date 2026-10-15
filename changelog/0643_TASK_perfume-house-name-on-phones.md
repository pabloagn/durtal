# Task 0643: A perfume house's name shows in full on a phone

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Fix
**Depends On**: 0642
**Blocks**: None

## Overview

Review of #327 (SLN-734), its one "should". In Edit perfume, a House chip
holds the house's name, its role menu and its Remove cross. With the menu
and the cross 44px on touch (0642), the name got what was left and was cut
to a few letters: at 320 it showed 38px of "Seed Organization 1" in
Chromium and Firefox and 26px in WebKit, so "Maison Francis Kurkdjian"
showed two or three letters.

## Implementation Details

- `perfume-fields.tsx`, `OrganizationRolesField`: on touch the chip wraps
  and the name takes a line of its own, with the role menu and the cross
  under it. This is the credit chips' pattern from 0642 (same classes), so
  the house and perfumer rows look the same on a phone. Desktop is
  unchanged: one line, the name cut only when the dialog is narrower than
  the chip.
- Test: `src/__tests__/ui/chip-touch-targets.test.ts`.

## Completion Notes

- Measured in Edit perfume on a production preview in Chromium, Firefox
  and WebKit at 1440, 390 and 320, with the seed house and with the name
  set to "Maison Francis Kurkdjian":
  - before (main after #327): at 390 the name showed 84px in Chromium and
    Firefox and 74px in WebKit; at 320, 38px and 26px. Always cut;
  - after: the name is never cut. At 390 it takes one line; at 320 it
    wraps to two, and its first line sits level with "House";
  - the role menu and the cross stay 44px and do not overlap; nothing
    scrolls sideways; the touch and alignment audits are clean;
  - at 1440 every size is the same as before.
- At 320 (and at 360 in WebKit) the cross goes under the role menu, as a
  credit chip's already does there: the 112px label column leaves the
  chip 136-148px.
- `page-weight.js` passes. Typecheck clean, lint no errors, UI tests pass
  (99 files). No migration, no new package.
