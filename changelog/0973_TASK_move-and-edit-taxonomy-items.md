# Task 0973: Taxonomy items can be moved and edited

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0972
**Blocks**: None

## Overview

SLN-1158 (taxonomy survey findings 2, 3 and 8).
- A term's parent couldn't be changed, although three messages told people to move it.
- A drag into another branch changed nothing on screen but renumbered the family.
- A description typed for Themes, Genres, Tags, Keywords or Art movements was thrown away without a word, and no description could be edited anywhere.
- New item's parent picker was a flat, unsearchable list of every name.

## Implementation Details

- `src/components/taxonomy/parent-picker.tsx`: `ParentPicker` searches every item's path ("Fiction / Short story").
  - "Top level" comes first, and the current parent stays in view.
  - At most eight choices show, with "N more; type to narrow the list", so the list never scrolls inside its dialog.
  - The field is a `data-picker`: arrow keys and Enter pick a choice.
  - A move leaves out the item and everything under it (`subtree`).
- `src/components/taxonomy/edit-item-dialog.tsx`: `EditItemDialog` has two modes.
  - Edit: name, colour, description where the family stores one (loaded on open by `getTaxonomyItemDescription`), and parent.
  - Move: parent only.
  - Only changed fields are sent.
- Where the dialogs open:
  - The row menu has Edit… and Move to… (Move only in hierarchical families).
  - The term page has Edit at the header's right (`term-actions.tsx`).
  - New item uses the same picker, and shows Description only where it is stored.
- `TaxonomyTree` reorders siblings only.
  - A drop under another parent shows "A drag keeps an item among its siblings. Use Move to… to put it under another item."
  - The unused `onMove` prop is gone.
- Server (`src/lib/actions/taxonomy-families.ts`):
  - `reorderTaxonomyItems` refuses ids under more than one parent, and its refusals are readable.
  - `createTaxonomyItem` and `updateTaxonomyItem` refuse a non-empty description for a family that keeps none ("Themes keep no description").
  - `storesDescription` is in `taxonomy-storage.ts`.
- No schema change: adding descriptions to the five families would be a migration, which was not asked for.

## Completion Notes

- New database case in `taxonomy-applicability.test.ts`:
  - A cross-branch reorder is refused, and `sort_order` is unchanged.
  - A sibling reorder works.
  - A move under another parent and back to the top level works, and a move under its own child is refused.
  - A description is kept for a custom family and refused for Themes, on create and on edit.
