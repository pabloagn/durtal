# Task 1035: Enter in Add to collection does what the highlighted row says

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: 1033 (SLN-1059)
**Blocks**: None

## Overview

SLN-1350, from findings/task-flows.md item 3. In Add to collection, typing "deca" listed "Decadents" as the only match, but Enter created a new collection named "deca" with the book in it: the field added to an existing collection only on a whole-name match, and its button said "Create & add" for a partial one.

## Implementation Details

- `add-to-collection-dialog.tsx`: Enter in the field acts on the highlighted row. Typing highlights the collection of that very name (accents and case aside), else the first match. Up and Down move the highlight through the matches and the Create row, wrapping; each new search starts on its first match again.
- "Create" is a row of its own at the end of the list, shown when no collection has the typed name: `Create "deca"`. It is Enter's target only when nothing matches or the arrows reach it; a click on it creates and adds.
- The field's button names what Enter will do: `Add to "Decadents"`, `Create "deca"`, or `Already in "Decay"` (disabled) for a collection that holds everything chosen. A long name is cut in the button (its tooltip has it whole) and wraps in full in the list. A visually hidden live line tells a screen reader the same.
- The highlighted row takes the hover tone (`data-active`).

## Completion Notes

- Component tests (`collection-enter.test.ts`): a partial match adds and creates nothing; a whole name wins over an earlier match and, when already held, does nothing; the arrows reach Create and wrap; no match creates; a new search starts on its first match. `accent-duplicates` follows the new label.
