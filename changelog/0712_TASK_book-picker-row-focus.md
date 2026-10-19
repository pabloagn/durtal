# Task 0712: Book picker rows show the house focus outline (SLN-872)

**Status**: Completed
**Created**: 2026-10-16
**Priority**: LOW
**Type**: Fix
**Depends On**: 0711
**Blocks**: None

## Overview
Item 5 of the hover and focus survey (`findings/hover-focus-survey-2026-10-15.md`) found that a book picker row showed keyboard focus only as a faint background, about 1.1:1 against the row. The picker is used for "Add a quote" on /reading/notes, the reading dialogs, the reading import and linking an e-book. Each row now keeps that background and also shows the house's 2px steel outline.

## Implementation Details
- `src/components/reading/book-picker.tsx`: the row button drops `focus-visible:outline-none` and takes `focus-visible:-outline-offset-2`. The outline is inset so the list's scroller (`overflow-y-auto`) cannot cut it, as with `action-control`.
- Test: `src/__tests__/ui/book-picker-focus.test.ts`.

## Completion Notes
Checked on a production build in Chromium, Firefox and WebKit at 1440 and 390, tabbing through the "Add a quote" picker on /reading/notes:
- Each row shows a solid 2px outline at -2px over its background.
- The outline fits inside the list's scroller with nothing cut.
- In Firefox, the first Tab stops on the scrolling list itself before the rows; that stop was already there.

The alignment audit is clean on /reading/notes in all three browsers at 1440, 1024, 390 and 320.
