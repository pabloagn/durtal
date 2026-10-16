# Task 0805: Dialog keys: a search alone closes on Escape, a rename ends on its name, Enter does nothing when the main button is off

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0801, 0802
**Blocks**: None

## Overview
SLN-863. The dialog keyboard survey (`findings/dialog-keys-survey-2026-10-15.md`) found five breaks; its tested fix is `findings/dialog-keys-fix.diff`. This task ships four of them. The fifth (a menu action leaves the focus on the page, Export among them) is the focus survey's cause 3, fixed at the shared menu in 0802, with Export's busy button in 0801, so its part of the diff is left out here rather than done twice.

## Implementation Details
- **A search alone asks "Unsaved changes" on Escape** (Add to collection, a series' Add books): the result rows' checkboxes counted as fields of a draft. Both dialogs pass `dirty` for what is picked instead of `draft`, so Escape asks only when books are picked.
- **A rename ends with the focus on the page** (a taxonomy family's row, Actions > Rename): Enter or Escape in the name field gives the focus to the item's name (`taxonomy-item-row.tsx`).
- **Link an eBook drops the focus out of its dialog** (Chromium, WebKit): the search field was disabled while a search ran. It stays enabled (the search's own counter already drops stale results), Search shows its busy state, and a press on Search hands the focus to the field (`ebook-picker.tsx`).
- **Enter adds a new line when the main button is off** (Link a work's Notes with no work chosen, Add source, Add bottle or sample, Add venue): `enterButtonOff` in `shortcuts.ts` finds the button Enter would press, on or off, and the shortcuts provider swallows plain Enter in a dialog text box while that button is off. Shift+Enter still starts a new line.
- Tests: `add-books-search-escape.test.ts`, `taxonomy-rename-focus.test.ts`, `ebook-picker-focus.test.ts`, `enter-and-leaving.test.ts`.

## Completion Notes
Applied from the survey's diff on main eb6875a8, without its `dropdown-menu.tsx` and `export-menu.tsx` hunks and their two tests (0801 and 0802 cover them). See the PR for the browser checks.
