# Task 0191: Author pickers search every author

**Status**: Completed
**Created**: 2026-09-28
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview
The author pickers could not find authors late in the alphabet. The book page loaded only the first 1000 of 2145 authors (A–Z) and filtered them in the browser, so "Rachilde" (position ~1560) never appeared. The author page loaded 5000 authors for the merge dialog and would fail the same way later.

## Implementation Details
- New hook `src/hooks/use-author-search.ts`: debounced server search through `searchAuthorsLite`. A blank query returns nothing. Answers to an older query never replace a newer one.
- `src/app/library/[slug]/work-edit-dialog.tsx` and `src/components/books/work-quick-edit-dialog.tsx`: use the hook. "Create" shows only after the search ends and only when no result has the same name.
- `src/components/books/edition-form.tsx`: contributor suggestions use the hook. A picked suggestion keeps its id; a typed name is resolved on save by `findOrCreateAuthor`.
- `src/app/authors/[slug]/author-merge-dialog.tsx`: uses the hook and keeps the picked authors as objects.
- Removed the `getAuthors({ limit: 1000 })` preloads (book page, quick edit) and `getAuthors({ limit: 5000 })` (author page), and the `availableAuthors` / `allAuthors` props.
- `edition-detail-card.tsx`: actions show when `workId` is given (before: when the author list was not empty).
- `author-merge-dialog.tsx`: the arrow between "Will be deleted" and "Will be kept" sits on the label line with `CapAligned`, and the row aligns to the top, so the arrow stays put when the picked names wrap. It was 12.6px off.

## Completion Notes
- `pnpm typecheck` and eslint on the changed files pass.
- Browser check on :3100 (no saves): the book Edit form and the card quick-edit form find "Rachilde" (position ~1560 of 2145) and hide "Create"; edition contributors find "Hawthorne"; the merge dialog finds "Émile Zola" and excludes the kept author.
- `scripts/qa/alignment-audit.js`: book page with the Edit form open (36 icons) and the edition form open (31), author page with the merge dialog open, with and without a picked name (26), and with the quick-edit form open (32): no deviation over 0.5px.
- Renumbered from 0151 to 0191: 0151 was taken by another task.
