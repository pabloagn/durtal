# Task 1006: Painters, a perfume's people and film credits share the credit row

**Status**: Completed
**Created**: 2026-10-20
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 1071 (SLN-1131, books and editions)
**Blocks**: None

## Overview

SLN-1131's addition of 19 Oct (`findings/credits-and-roles.md`, finding 4). A painting's painters and a perfume's people (a fragrance's credits and a formulation's perfumers) kept the order they were added, as chips with only Remove. Films had Move up and down, but their own copy of the buttons, with none of the focus handling the book forms now have.

## Implementation Details

- `paintings/painting-fields.tsx` and `perfumes/perfume-fields.tsx`: each painter or person is a credit row (`CREDIT_ROW`): the name, its attribution or role menu, and `CreditRowControls` (Move up, Move down, Remove, each named after its person). The list's order is what the form saves; `replaceWorkCredits` writes each place as `sort_order`.
- A perfume credit added in the form gets its own key (`creditEntryKey`), so a moved row keeps its focus; a stored one keeps its id. The perfume organizations stay chips.
- `films/film-fields.tsx`: `CreditRow` uses `CreditRowControls` in place of its own buttons, so a film credit moved down keeps the focus too, and its name keeps a 24px line on touch.
- `CreditRowControls`: when the last row goes, the focus moves to the list's Add.

## Completion Notes

- **Tests:**
  - `ui/record-credit-order` (new): painters and a perfume's people move, are saved in their new order, and keep the focus. The role stays with its person.
  - `ui/chip-touch-targets` and `ui/standard-focus-ring` follow the rows.
