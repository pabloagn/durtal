# Task 0524: A then F favourites, A then C opens the item's collections

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0523
**Blocks**: SLN-634

## Overview

SLN-571. Bare F toggled the open page's favourite, and A then F added a
film, A then C created a collection. As the owner asked, A then F now
favourites the page's item and A then C opens its collections picker (the
same one its folder button opens, with its work or edition). Where the page
has no such item, A then F still adds a film and A then C still creates a
collection. Bare F does nothing.

## Implementation Details

- `src/components/shortcuts/shortcuts-provider.tsx`:
  - `useShortcut(key, label, run, "a")` registers a key that follows A for
    the open item. After A, the newest such key wins over the Add entry of
    the same key; one sequence never runs two actions.
  - Bare single keys ignore prefixed entries.
  - `itemKeys()` in the context lists the keys the open item takes.
- `src/components/shared/favourite-toggle.tsx`: the page's star registers A
  then F; its tooltip shows "A then F".
- `src/components/books/add-to-collection-dialog.tsx`: `CollectionShortcut`
  (A then C) and `CollectionButton`'s `shortcut`; the book page's work
  button uses it, with its tooltip. Film, perfume and painting actions
  register it for their Collections dialog.
- `src/components/shortcuts/shortcuts-help.tsx`: the "This page" group shows
  A then F and A then C when the page has them.
- `src/lib/shortcuts/shortcuts.ts`: the Add group says both meanings: "Film,
  or favourite the page's item", "Collection, or add the page's item to a
  collection" (`ITEM_KEY_LABELS`).
- `src/components/layout/command-palette.tsx`: where the item takes A then F
  or C, "Add a film" and "Add a collection" show no keys.

## Completion Notes

- `src/__tests__/ui/item-keys.test.ts`: A then F saves the favourite once
  through the real star, bare F does nothing; A then C opens the item's
  collections, not Create collection; on a page with no item they add a
  film and create a collection; an item that leaves the page leaves no key
  behind; the sheet's labels.
- Docs: `docs/04_ROUTES_AND_VIEWS.md` (shortcuts), `docs/15_KEYBOARD.md`
  (key map and page families).
