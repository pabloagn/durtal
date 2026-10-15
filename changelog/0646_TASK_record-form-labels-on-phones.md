# Task 0646: Record forms on a phone: labels over their chips, names never cut

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0642, 0643
**Blocks**: None

## Overview

SLN-639 and SLN-641 follow-up. The record forms (film, painting and perfume
add pages and Edit dialogs, Add copy, Add a reproduction, Link a work, and
the other forms built on `record-fields.tsx`) put every chip row's label in
a 112px column beside its chips, at every width. On a phone that left the
chips 136-148px at 320, so a chip with a role menu (a house, a perfumer, a
painter) dropped its cross onto a line of its own, and with a mouse in a
narrow window a house's name was cut to nothing (review of #331). The
fields' own labels (Title, dates) already sat over their inputs.

## Implementation Details

- `record-fields.tsx`, `FieldRow`: below `sm` the label sits over the chips
  in the field label's look (`type-label`: 12px, medium, 20px line) and the chips take the
  row's full width. From `sm` up nothing changes.
- `AddButton` ("Add", "Choose"): below `sm`, when it starts the chips' row,
  it pulls out by its padding so its icon starts on the label's edge
  (docs/03, Spacing Scale). The alignment audit read it 6px in once the
  label moved above.
- `ROLE_CHIP` and `ROLE_CHIP_NAME` (new, shared): a chip holding a menu as
  well as its name gives the name a line of its own on touch, as before
  (0642, 0643), and now also below `sm` with a mouse. Used by the house,
  perfumer and painter chips. The film credit row's name wraps below `sm`
  the same way.
- `CHIP_NAME` (new, shared): below `sm` a plain chip's name (a country, a
  studio, a movement) wraps in full instead of being cut; on touch its
  lines keep the 44px line's center for the cross. Used by every plain chip
  in `record-fields.tsx`, `film-fields.tsx` and `perfume-fields.tsx`.
- Test: `src/__tests__/ui/chip-touch-targets.test.ts`.

## Completion Notes

- Measured on a production preview of a disposable seed database in
  Chromium, Firefox and WebKit, at 1440, 640, 639, 390 and 320 (touch below
  800): Edit film, painting and perfume, their add pages, Add copy, Add a
  reproduction and Link a work, 13 to 14 forms a width.
  - Below 640 every row's label sits over its chips (6px gap), and the
    chips take the row's full width: 272px at 320 in Chromium and Firefox,
    260px in WebKit (148px and 136px on main). From 640 up every row is
    as on main, label beside chips.
  - WebKit also stacks at exactly 640, as it does every `max-sm` rule
    there.
  - A row-starting Add or Choose sits on the label's edge (0.00px). Before
    the pull-out the alignment audit read it 6px in.
  - Alignment, touch and overflow audits are clean in every form at every
    width.
- Long names ("Maison Francis Kurkdjian Parfums de Paris" in every chip),
  with touch and with a mouse, at 390 and 320 in three engines: no chip's
  name is cut, nothing overflows, and the audits are clean. With a mouse
  before `CHIP_NAME`, 7 chip names were cut in Edit film at 320 and 3 in
  Edit painting.
- `page-weight.js` passes. Typecheck clean, lint no errors, UI tests pass
  (103 files). No migration, no new package.
- Review of #335: the label's line is 20px, the field label's own
  (`type-label`), so a row's label sits as far over its chips as a field's
  label over its input (the reviewer's fix, with its test).
