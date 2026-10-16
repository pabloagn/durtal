# Task 0804: Focus after a page change, and after a layer the palette opened

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
SLN-856. Focus survey, cause 5 (`findings/focus-survey-2026-10-15.md`).

When the app moved to another page, the focus was on a control of the page that went, so it fell to the page body and the next Tab started from the top: after a palette pick or "Go to" item, after a rename that gives a book a new address, after deleting a collection. And the palette's "Keyboard shortcuts", closed with Escape, left the focus on the body rather than where it was before the palette.

Found on the way: renaming a person left the page on "Person not found", because a new name gives a new address and the page only refreshed the old one.

## Implementation Details
- `src/components/shared/navigation-focus.tsx` (`NavigationFocus`, in the catalogue layout): on a new path, while the focus is lost, it goes to the same named control on the new page when there is one (a renamed book's Actions, which had it before the move; matched by its name and its place among controls of that name), else to the page's `h1`, made focusable with `tabIndex={-1}` and shown without a ring. A focus that survived the change (a sidebar link) is left alone, and so is any place the reader moves it to. The new page may stream in after its loading screen, so it checks again as the page changes, for a few seconds. A list's pages keep the path, so paging keeps its own target (0800).
- `src/lib/ui/surface-state.ts`: a surface that closes hands its focus origin to a surface opening as it closes for a frame, not a microtask. The palette's "Keyboard shortcuts" opens in the render after the palette's close, which came after the microtask, so the help took the palette's removed field as its origin.
- Person rename: `updateAuthor` returns the new slug when the name gave one, and Edit person moves to it, as Edit work does (`author-edit-dialog.tsx`).
- Tests: `src/__tests__/ui/navigation-focus.test.ts`; the author slug test in `atomic-book-writes.test.ts` checks the returned slug.

## Completion Notes
See the PR for the browser checks.
