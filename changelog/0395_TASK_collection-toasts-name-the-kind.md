# Task 0395: Collection Toasts Name What Was Collected

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Fix
**Depends On**: 0393
**Blocks**: None

## Overview

SLN-545, found by the collect journey (task 0393). Collections hold
perfumes, films and paintings since SLN-362, but their messages still spoke
of books: creating a collection from a perfume said "Collection created and
books added", and deleting any collection said "Collection deleted. Books
remain in your library." The messages and labels around collections now name
what is collected.

## Implementation Details

- `src/lib/collections/counts.ts`:
  - `worksNoun(kinds)` names some works by their kind, one kind per work:
    "perfume", "films". Works of more than one kind are "items", as the
    collection counts already say.
  - `collectionCreatedMessage` and `collectionDeletedMessage` build the two
    toasts from it.
  - `collectableNouns()` lists the kinds a collection can hold, from the
    enabled kinds: "books, perfumes, films and paintings".
- The collections dialog (`add-to-collection-dialog.tsx`), after Create &
  add: "Collection created with this perfume", "Collection created with these
  2 books", "Collection created with these 3 items". A book counts once,
  however many of its editions were chosen. Its other messages ("Added to
  collection", "Removed from collection", the errors) and labels name no
  kind, and the notes about editions show only for books, so they stay.
- Deleting a collection (`collection-controls.tsx`): "Collection deleted. Its
  films stay in your library.", "Its painting stays", "Its items stay", or
  "Collection deleted" for an empty one. The collection page passes what it
  holds, one kind per work, a book once (`kinds`). The confirmation already
  named every kind and is unchanged. When artwork cleanup needs a retry the
  message is unchanged.
- `/collections`: the description is "Curated groups of books, perfumes,
  films and paintings" (was "of books"), and the empty state says "Create
  collections to organize your books, perfumes, films and paintings into
  curated groups". The New collection dialog says "Add what it holds and its
  artwork after creating it." (was "Add books and artwork").
- The design audit, run on the changed screens, found a collection without
  artwork reading its placeholder letter as faint text (contrast 1.13 on the
  collection page, 1.21 on a collection card). The letter is decorative, as a
  book's is: it takes `aria-hidden` and `data-decorative` on the collection
  page and on `CollectionCard`.
- Test: `src/__tests__/catalogue/collection-nouns.test.ts`.

## Completion Notes

COMPLETION_NOTES
