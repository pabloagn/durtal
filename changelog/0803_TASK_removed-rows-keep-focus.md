# Task 0803: Removing a row hands the focus to the next one

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-855. Focus survey, cause 4 (`findings/focus-survey-2026-10-15.md`).

Deleting or removing a row left the focus on the page body, so the next Tab started again from the top of the page:
- /locations: Delete location > Delete;
- a book's copies: a copy's Delete > Delete;
- a collection: "Remove <title> from collection";
- Settings > Reader, Lookup: "Remove source <name>";
- the Reading hub and Up next, when a menu item (Pause, Never, Remove from Up next) takes the book's card or row away.

## Implementation Details
- `src/components/shared/focus-keeper.tsx` (`FocusKeeper`, mounted once in the catalogue layout): a list marks itself `data-focus-list="<name>"`, each row `data-focus-row`, and the control for an empty list (its Add) `data-focus-empty="<name>"`.
  - On every focus it notes the row, its place in the list and the control's place in the row. A dialog or menu opened from the row (Delete's confirmation, More) keeps the place of the control that opened it.
  - When that row leaves the page with the focus lost (a mutation observer, and a dialog's close), the focus goes to the same control of the row that took its place (the next Delete for a Delete), else the row before, else the list's empty control, else the page's heading.
  - It does nothing while a dialog is still open, or when the focus is anywhere else.
- Marked lists: locations (Add location), each edition's copies (Add instance), a collection's items (Add to the collection), the Lookup sources (Add a source), Up next (Add from your library), and the Reading hub's Currently reading, Paused and Suggestions.
- A page heading that takes the focus (`h1[tabindex="-1"]`) shows no focus ring: it is not a control (`globals.css`).
- Test: `src/__tests__/ui/focus-keeper.test.ts`.

## Completion Notes
See the PR for the browser checks.
