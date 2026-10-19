# Task 0834: Deletes and moves keep the focus

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0827 (SLN-913)
**Blocks**: None

## Overview

SLN-1028, from findings/focus-survey-2026-10-18.md (cause 2) and the review of #496. A confirmed delete closed its dialog onto the row's menu, then the refresh removed the row and the focus fell to the page body, in sections FocusKeeper did not know about. Moving a collection card later, or earlier into first place, dropped the focus too.

## Implementation Details

- Marked with `data-focus-list`, `data-focus-row` and, on each section's Add, `data-focus-empty`:
  - film copies and versions;
  - perfume bottles, formulations and retailers;
  - a painting's originals and its reproductions, one list each;
  - Wanted (every kind);
  - the book page's editions, with Add edition as the empty target;
  - the book page's readings, current and past as one list, with the header's Reading control as the empty target;
  - book cards (`BookGrid`, `BookCard`), people cards and rows on /people, and every mosaic.
- A past reading's menu was named "1st read: actions", and the open one "More reading actions". FocusKeeper finds the next row's control by its first word, so the past one is now "More actions for the 1st read".
- FocusKeeper keeps the list element along with its name, so on a page with two lists of one name (two grids of books) the focus stays in the list it was in. Test in `focus-keeper.test.ts`.
- Collection cards (`CollectionMemberControls`): Move earlier and Move later are held (`aria-disabled`) at the ends instead of `disabled`, which dropped the focus. A move runs its refresh in a transition. Once the refresh is in, the focus goes back to the Move pressed, or to the other Move when the card reached that end.

## Completion Notes

In Chromium, Firefox and WebKit at 1440, on the preview with extra copies, versions, bottles, reproductions, Wanted entries, readings, editions and a four-book collection, the focus lands as follows:

- After deleting the first of three, it goes to the next row's menu.
- After deleting the last row, it goes to the row before.
- After deleting the only row, it goes to the section's Add, or to the Reading control for readings.
- After Move later, Move earlier into first place, Move later into last place and a move in the middle, it stays on a Move button in the moved card.

The alignment, design, overflow, layout and touch audits are clean on the nine affected pages in three browsers at 1440, 390 and 320. Page weight passes.

Tests: `src/__tests__/ui/deletes-keep-focus.test.ts` and `src/__tests__/ui/focus-keeper.test.ts`.
