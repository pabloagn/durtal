# Task 1137: Enter adds to the one collection a name finds

**Status**: Completed
**Created**: 2026-10-20
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1350. In Add to collection (a book's Collections button, or A then C),
typing part of a name such as "deca" and pressing Enter created a new
collection called "deca", though the list showed Decadents as the only match.
The field added to an existing collection only when the whole name matched,
and its button kept saying "Create & add".

## Implementation Details

`src/components/books/add-to-collection-dialog.tsx`:

- `target`, the collection Enter adds to: the one whose name is the one typed
  (accents, case and punctuation aside, as before), else the only collection
  the typed text finds. With no match, or several and none by that exact
  name, there is no target and Enter creates the collection typed.
- The button reads "Add" with a target and "Create & add" without one, and
  its accessible name says which: "Add to Decadents", or Create & add "deca".
- The target's row is lit with the hover background, so a sighted reader sees
  which collection Enter adds to.

docs/15 (Pickers and managers) describes the rule.

Test: `src/__tests__/ui/collection-enter.test.ts`, a partial match, an exact
name among several matches, several partial matches, and no match. Three of
its four cases fail without the change.

## Completion Notes

The list has no arrow-key highlight of its own; a highlight that moves with
↑ and ↓, as the search pickers have, belongs with SLN-1294 (pickers silent to
a screen reader). Typecheck and lint clean; the related dialog tests pass. The
database suites run in CI (the container's disk is full).
