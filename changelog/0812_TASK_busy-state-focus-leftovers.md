# Task 0812: Busy-state focus leftovers

**Status**: Completed
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: 0808
**Blocks**: None

## Overview
SLN-920, from the review of #450 (`findings/review-pr-450.md`, notes 1 to 3).
All of these happened on main too.

## Implementation Details
- `Button` (`src/components/ui/button.tsx`): a busy button no longer takes
  `pointer-events-none`. A second mouse click went through it and focused the
  dialog behind; now the button takes the click, `ignorePress` swallows it, and
  the focus stays on the button. It shows the default cursor while busy.
- New collection (`create-collection-dialog.tsx`): Name and Description are
  read-only while it saves, not disabled, so Enter in Name (the usual way to
  create) keeps the focus in the field.
- Taxonomy family page: the item list is a FocusKeeper list
  (`data-focus-list="taxonomy-items"`, a `data-focus-row` per row) and both New
  item buttons are its Add. After Merge or Delete the focus goes to the next
  row's Actions, else the row before's, else New item.
- The first item in an empty family replaces the empty state and its New item:
  the toolbar's New item takes the focus once the list shows
  (`taxonomy-family-shell.tsx`).
- A new collection (`collection-controls.tsx`) and a new series
  (`series-actions.tsx`) open on their Add dialog. It now opens from the
  header's Add (Add books for a series), as the empty collection's button
  already did, so the focus comes back there after Add or Cancel instead of
  falling to the page body.

## Completion Notes
- `busy-focus-leftovers.test.ts` (7 tests, 6 fail without the fix) renders the
  busy Button and the taxonomy list under FocusKeeper.
