# Task 0197: The Book Experience on the Shared Substrate (SLN-365)

**Status**: Completed
**Created**: 2026-10-03
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0158 (shared people and credits), 0162 (shared curation), 0188 (SLN-364)
**Blocks**: SLN-379, SLN-380, SLN-381

## Overview
Book saves now use the adapters every collection shares, each save is one
transaction, and person pages count books as "books". The book forms, URLs and
API payloads do not change; edition and copy UI stay book-specific.

## Implementation Details
- `src/lib/catalogue/curation-store.ts`: `curationQueries(d, owner, patch)`, the
  writes of personal curation (notes, rating, favourite, recommendations) for
  one atomic batch, and `hasCurationChanges`. A repeated recommender is stored
  once. `updateWorkCuration` (shared curation action) now uses it.
- `createWork`: gives the book its id and slug before writing, then writes the
  work, its authors (`bookAuthorQueries`), subjects and recommendations
  (`curationQueries`) in one transaction. Before, the work came first and each
  link was a separate write: a failure left a book without authors or a slug.
- `updateWork`: the work row, curation (`rating`, `notes`, `recommenderIds`),
  authors and subjects in one transaction. Before, each part was a separate
  write, and the recommendations were deleted before they were inserted: a
  repeated recommender made the insert fail after the delete, so the book lost
  all its recommendations. Activity still records rating changes.
- Fast Track writes its recommendations through `curationQueries`.
- The book page's edit dialog goes to the book's new address after a rename
  (`updateWork` returns `slug`). Before, it reloaded the old address, which is
  404 because old slugs do not redirect (task 0175b).
- Person pages: "Works" becomes "Books" on the author page (section and
  paging), author cards and rows ("3 books"), the dashboard's recent authors,
  the authors "Books" sort label, and the delete and merge confirmations.
- On a phone: the authors toolbar puts the search on its own row and wraps its
  sorts (the pattern of /places); the edition action row wraps and "Add
  instance" stays on one line.
- `scripts/qa/preview-local.py` clears the dev data cache
  (`.next/dev/cache/fetch-cache`) at start. A preview showed recommender names
  cached by the earlier rehearsal on a copy of live data.
- Unchanged by design: the edition contributor role list (docs and tests pin it),
  book identity (slug, ISBN and metadata fields; typed catalogue identifiers
  start with the other collections), the legacy book junctions.

## Completion Notes
- `src/__tests__/integration/book-saves.test.ts` (6 tests): create with slug,
  authors, subjects and recommendations; numbered slug; nothing created when a
  late part fails; an edit saved whole or not at all; a repeated recommender
  stored once, with the rating activity and the shared curation read; a sparse
  edit keeps other fields and its series. Against the old `works.ts`, 4 of the
  6 fail and the 2 that check preserved behaviour pass.
- The full local suite passes 1,237 tests across 93 files; lint and typecheck pass.
- Browser journey on the disposable preview: the add-book wizard (manual entry,
  existing author, recommender, edition, copy, collection) wrote one book with
  the slug `death-in-venice-by-thomas-mann`, the existing author, 1 edition, 1
  copy, the collection and the recommender. A second edition and a Calibre
  copy were added, an order placed (€12.50, the book became accessioned), then
  the title, rating and notes edited and the title changed back; the page
  followed both renames. Reading needs a Calibre library and was not tested.
- Alignment audit (with the `holder ?? text` fix) and design audit: 0 issues
  and 0 low-contrast text on the author page, the authors list, the book page
  and the dashboard at 1440, 768 and 390 px.
