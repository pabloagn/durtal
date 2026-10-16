# Task 0802: A menu item that acts in place gives the focus back to its menu's button

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-854. Focus survey, cause 3 (`findings/focus-survey-2026-10-15.md`).

Picking a menu item that acts without opening anything (the book page's Export > CSV, Actions > Copy, Actions > Add to Up next and its Remove) closed the menu and left the focus on the page body, in every browser. Escape already gave it back to the menu's button.

## Implementation Details
- `src/components/ui/dropdown-menu.tsx`: an item closes its menu with `closeAfterAction`. On the next frame, if the focus is on the page body (it went with the item), it goes back to the menu's button, as after Escape. An item that opened a dialog, or put the focus anywhere else, keeps it there. A button that has gone (its card was removed) is left alone: removed rows are cause 4.
- Test: `src/__tests__/ui/dropdown-menu.test.ts` (back to the button with the keyboard and the mouse; a field the item focused keeps the focus).

## Completion Notes
See the PR for the browser checks.
