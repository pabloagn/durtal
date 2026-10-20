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
  name, there is no target and Enter creates the collection typed. A name of
  punctuation alone finds nothing (the typed text is normalized once, and an
  empty result matches no collection).
- Beside a lone partial match, a row under the list, Create "deca" and add,
  still makes a new collection by that name, so a new "Den" can be made while
  Decadents exists. Its words start on the names' edge.
- The button reads "Add" with a target and "Create & add" without one, and
  its accessible name says which: "Add to Decadents", or Create & add "deca".
  It keeps the width of its longer label, so the field does not jump while
  typing.
- The target's row is lit with the palette's highlighted-choice background
  (`bg-selection-bg/60`), apart from the hover background.
- When the target holds every chosen book already, Enter adds nothing and says
  "Already in Decadents" rather than "Added to collection".

docs/15 (Pickers and managers) describes the rule.

Test: `src/__tests__/ui/collection-enter.test.ts`: a partial match, an exact
name among several matches, several partial matches, the Create row beside a
partial match, no Create beside the same name, a collection that holds the
book already, a name of punctuation only, and no match.

Self-review (code-review, high) found the partial match took away creating a
name that is part of another (fixed with the Create row), a punctuation-only
name matching every collection, a highlight test that could not fail, an
"Added" toast for a collection that held the book already, a highlight that
looked like hover, and a button whose width changed while typing; all fixed.

## Completion Notes

The list has no arrow-key highlight of its own; a highlight that moves with
↑ and ↓, as the search pickers have, belongs with SLN-1294 (pickers silent to
a screen reader). Typecheck and lint clean; the related dialog tests pass. The
database suites run in CI (the container's disk is full).
