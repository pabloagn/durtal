# Task 0653: A list that fits on one page shows no pager

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

Design-polish pass of 15 Oct (findings/design-polish-2026-10-15.md, item 2).
A list that fits on one page showed everything a long list does, every
arrow disabled:

- above the list, "‹ Previous 1 / 1 Next ›";
- below it, the count again, "« First ‹ Previous 1 Next › Last »", Per page
  and "Go to page [1] Go".

That covers most of what Joris opens: a person's books, a series, a
collection, Collections, Series, a filtered Books or eBooks, the reading
journal and notes.

## Implementation Details

- `src/components/shared/pagination.tsx`, when there is one page:
  - Above the list (`compact`) the count stays, with the list's action
    (Select). Per page stays only when a smaller page would split the list
    (more items than the smallest size). The arrows, "1 / 1" and the jump
    go.
  - Below the list nothing renders. Every list that pages on its own states
    its count above it (journal, notes, highlights). The size alone stays
    there while a smaller page would split the list: it is the size's only
    place on a phone and on the journal, notes and highlights, so a size
    chosen there can be changed back (review).
  - With two or more pages nothing changes.
- Test: `src/__tests__/ui/pagination-one-page.test.ts`.

## Completion Notes

- Measured on a production preview of a disposable seed database against
  main, in Chromium, Firefox and WebKit at 1440 and 390 (touch at 390).
  Pages: Books, a person, Collections, a collection, Series, eBooks,
  eBooks filtered to 39, the journal, notes, Publishers, Films, Paintings,
  Perfumes, Organizations, Places, Provenance, People.
  - One page: above the list only the count shows ("count, size, Select" on
    Books with 25 books, since 24 a page would split them); below it nothing.
    On main, every one of these showed both pagers.
  - Two or more pages (eBooks 55, Organizations 81, Places 61, People 604):
    both pagers are exactly as on main.
- Alignment, overflow and touch audits are clean on every page; the layout
  audit's only items are the journal's two rows, the same as on main.
- `page-weight.js` passes. Typecheck clean, lint clean, UI tests pass
  (669). No migration, no new package.
