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
  in the field label's look (12px, medium, 16px line) and the chips take the
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
- Test: `src/__tests__/ui/chip-touch-targets.test.ts`.

## Completion Notes

RESULTS
