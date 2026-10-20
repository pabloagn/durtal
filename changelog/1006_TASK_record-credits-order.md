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

- `paintings/painting-fields.tsx` and `perfumes/perfume-fields.tsx`: each painter or person is a credit chip a line wide (`CREDIT_CHIP`, `catalogue/record-fields.tsx`): its attribution or role menu, the name taking the room, and `CreditRowControls` (Move up, Move down, Remove, each named after its person). It keeps the role chip's metrics, so its first line stays on the row label's center, and on touch or a phone the name takes a line of its own. The list's order is what the form saves; `replaceWorkCredits` writes each place as `sort_order`.
- A perfume credit added in the form gets its own key (`creditEntryKey`), so a moved row keeps its focus; a stored one keeps its id. The perfume organizations stay chips.
- `films/film-fields.tsx`: `CreditRow` uses `CreditRowControls` in place of its own buttons, so a film credit moved down keeps the focus too, and its name keeps a 24px line on touch.
- `CreditRowControls`: when the last row goes, the focus moves to the list's Add (`data-credit-add`, on the record forms' Add and on Add author). A row that stays, as a book's last author does, keeps the focus.
- `films/film-fields.tsx` reorders with the shared `moveRow`.

## Completion Notes

- **Tests:**
  - `ui/record-credit-order` (new): painters and a perfume's people move, are saved in their new order, and keep the focus. The role stays with its person. Removing the last painter puts the focus on Add.
  - `ui/work-form-authors`: the last author's refused Remove keeps the focus.
  - `ui/chip-touch-targets` and `ui/standard-focus-ring` follow the rows.
- **Checks on main after #615:** `pnpm typecheck` and `pnpm lint` clean, `pnpm test:local` and `pnpm build` pass. The browser audit passes 27 of 27 page loads on Add painting, Add perfume and Add film. With two painters added on Add painting, in Chromium, Firefox and WebKit with a mouse at 1440 and touch at 390, the alignment audit finds nothing, and at 1440 the first painter's name sits on the Painters label's center (0px off). `page-weight.js` passes.
