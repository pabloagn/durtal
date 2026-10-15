# Task 0744: One count line for a collection (SLN-781)

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0742
**Blocks**: None

## Overview
Design polish pass 2, item 6 (`findings/design-polish-2-2026-10-15.md`). Collection counts used three different nouns: the collections index said "6 items", "4 editions" or "0 editions"; a collection of editions said "4 books · 4 editions" on its own page; an empty one said "Nothing yet".

## Implementation Details
- `src/lib/collections/counts.ts`: `collectionCountLine` names each kind held ("6 books", "4 editions", "3 books · 1 perfume"), counted as `collectionCounts` counts (a book held both ways once, as its edition), and returns `null` when the collection is empty. It replaces `collectionCountLabel` ("12 editions" or "5 items").
- `src/lib/actions/collections.ts`: the collection list's member summary carries each whole work's kind.
- The card ("Empty" when empty), the mosaic's subtitle, the Add to collection dialog's rows (its optimistic rows take each work's kind from the selection) and the collection page all use it. The page keeps "· N of M books read" after it, and still shows no line when the collection is empty (0742: its empty state says so).
- `docs/04_ROUTES_AND_VIEWS.md`, Collections: the card's count.
- Test: `src/__tests__/catalogue/collection-count-line.test.ts`.

## Completion Notes
The collection page of a collection of editions now reads "4 editions" where it read "4 books · 4 editions".
