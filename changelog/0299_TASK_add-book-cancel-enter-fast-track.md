# Task 0299: Add Book: Cancel on Every Step, Enter Runs Fast Track (SLN-437, SLN-438)

**Status**: Completed
**Created**: 2026-10-04
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Two fixes from Joris on the Add book page (`/library/new`):

1. SLN-437. There was no way to leave the page without adding a book. The "Possible duplicate found" panel offered only "Add edition to this work" and "Create as new work". Every step now has a Cancel.
2. SLN-438. Enter on the Details step went to the next step (Edition details). Joris almost always uses Fast Track, so Enter now runs Fast Track.

## Implementation Details

The wizard is `src/app/library/new/wizard.tsx`.

- **Cancel**: one `cancelButton` (ghost), shown on all seven steps. On Search it sits at the right of the "Enter details manually" row; on the duplicate panel after its two choices; on the other steps beside Back. It goes back to the page the user came from (`router.back()`), or to `/library` when the page was opened directly. Nothing is saved before Fast Track or "Add to catalogue", so leaving saves nothing. It is disabled while a save runs.
- **Enter**: on Details, Fast Track carries `data-shortcut="next"`, so Enter in a one-line field presses it (the shortcut rules in `src/lib/shortcuts/shortcuts.ts`). Its tooltip shows the key. "Edition details" takes Enter only when Fast Track is not shown (a book added to an existing work). When the title or the author is empty, Fast Track is disabled and Enter does nothing, as for any disabled shortcut button. Enter keeps its normal behaviour in the description box (a new line) and in open pickers (it picks). ⌘Enter is unchanged: Fast Track on Details, "Add to catalogue" at the end.
- **Focus**: the Title field takes the focus when Details opens, so Enter works right after a search result is picked.
- **Docs**: the shortcut sheet's Enter row reads "Pick, confirm, next step, Fast Track" (`src/lib/shortcuts/shortcuts.ts`); `docs/04_ROUTES_AND_VIEWS.md` says what Enter does on Details and adds Fast Track and Cancel to the Add Book section.

## Completion Notes

- CHECKS
