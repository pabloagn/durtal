# Task 0330: S opens search, Esc closes every search

**Status**: In Progress
**Created**: 2026-10-05
**Priority**: MEDIUM
**Type**: Feature
**Depends On**: None
**Blocks**: None

## Overview
SLN-477. Joris: "S, so open the search dialogue to search quickly, and Esc to exit ANY search dialogue, and I MEAN ANY". A bare `S` opens the command palette on any page; Escape closes or leaves every search surface, one layer per press.

## Implementation Details
- `S` (`SHORTCUTS.openSearch`, `src/lib/shortcuts/shortcuts.ts`; handled in `shortcuts-provider.tsx` with the other single keys): it opens the palette, as `⌘K` does. Like every single key it does nothing while typing, with ⌘, Ctrl, Alt or Shift held, while a dialog is open, or in the e-book reader, where `S` keeps opening the reader's settings. An open menu takes every key first, so `G S` (Series), `A S` (a series) and `R S` (start reading) are unchanged. `/` is unchanged.
- The shortcuts sheet (`?`) lists `S`; the Esc line reads "Close a search, a list, a menu or a dialog".
- Escape, one layer per press: a popover or a list takes Esc first and calls `preventDefault`, which keeps the native `<dialog>` around it open (its `cancel` is the key's default action); the next Esc closes the dialog. Fixed where Esc closed two layers at once or none:
  - Google Places search, the collection icon picker, the date picker, dropdown menus, the work form's author search: Esc closed the popover and the dialog around it.
  - The filter panel (`filter-dropdown.tsx`): Esc did nothing; it now closes the panel and focus goes back to the Filter button.
  - The place picker: Esc closed the dialog around it; it now clears the field and so closes its list, as the publisher picker does.
  - The Add book search: Esc clears the results when there are some; with none, it leaves the field.
- A search field on a page (no dialog around it, no list of its own that took the key: the list, collection, taxonomy, harmonize and reader library searches): Esc leaves the field and keeps its text (`shortcuts-provider.tsx`).
- The command palette: Esc closes it, and focus goes back to what had it before it opened.
- Unchanged, as they already close on Esc and keep the layers apart: the dialogs (native `<dialog>`, `src/components/ui/dialog.tsx`), the select (`ui/select.tsx`), the search picker, the publisher picker, taxonomy assignments, the leader menus.
- Docs: `docs/03_DESIGN_LANGUAGE.md` (keyboard), `docs/04_ROUTES_AND_VIEWS.md` (shortcuts).

## Completion Notes
SUMMARY
