# Task 0380: One media manager, one selection bar, the add-book wizard in steps

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0293
**Blocks**: None

## Overview

SLN-513: what 0293 (SLN-302) left out because open PRs were changing those
files. The book and person media managers were near-copies, and so were the
library's and the people list's selection bars: a fix landed in one copy and
not the other. Each pair is now one shared component. The add-book wizard
(1,676 lines in one file) is split into its steps, and the two list pages call
`useSelection` directly.

## Implementation Details

- **Media manager** (`src/components/media/media-manager-dialog.tsx`, moved
  from `components/books/`, since books, people, collections, perfumes, films,
  paintings and publishers all use it): one `MediaManagerDialog` with
  `entityType="author"` for a person. What only a person's images have comes
  with that owner: the monochrome settings button on an image with a color
  original (SLN-316), its `MonochromeControls`, and uploads made monochrome
  (`DEFAULT_MONOCHROME_PARAMS`). `author-media-manager-dialog.tsx` is gone; the
  person page opens the shared dialog. Each tab now loads through
  `getMediaByType(..., "author")`, as every other owner's does, so
  `getMediaForAuthor` had no caller and is removed (docs/06 updated).
- **Selection bar** (`src/components/shared/selection-toolbar.tsx`): one
  `SelectionToolbar` with the count, Select all, Deselect, the list's own
  actions, Delete (asks first, then deletes one record at a time) and Exit.
  A list gives it the names for the confirmation, its nouns
  (`["work", "works"]`, `["person", "people"]`), its delete action and
  cascade text, and its actions as a function of whether a delete is running.
  `BulkActionToolbar` (status, priority, marks, rating, reading, collections,
  Up Next, export) and `AuthorBulkActionToolbar` (favourites, export) keep
  their names and props and only supply those.
- **Add-book wizard** (`src/app/library/new/`): `wizard.tsx` keeps the book
  being added and the flow (search, duplicate check, Fast Track, the one
  write, leaving the edition step only when its ISBN is free, Cancel). Each
  step is a component in `steps/`: `search-step`, `duplicate-step`,
  `details-step`, `edition-step`, `copies-step`, `categorize-step`,
  `confirm-step`. `step-progress.tsx` has the progress row and the steps'
  shared Back / Cancel / actions row. `wizard-model.ts` has the step list, the
  drafts (the work, the edition, the taxonomy as one record per family) and
  the payloads Fast Track and "Add to catalogue" send, as plain functions.
  `use-wizard-options.ts` loads what the steps choose from, when a step first
  needs it, as before. The search state stays in the wizard, so going back to
  Search keeps the query, as before. The wizard's own search result type was a
  copy of `SearchResult` in `src/lib/api/types.ts` and now uses it.
- **Selection hooks**: `library-shell.tsx` and `authors-shell.tsx` call
  `useSelection`; `use-library-selection.ts` and `use-author-selection.ts` are
  removed.
- Test: `src/__tests__/library/wizard-model.test.ts` (the drafts' defaults and
  ISBN from the link, what a search result fills in, the work's values, one
  valid write for a new work and for an edition of an existing one).

### What changes for a person's images

The shared dialog behaves the same for every owner, so a person's media
manager gets what only the book one had:

- The image details form (alt text, credit, license and links, SLN-361): under
  the active poster or background, and for a clicked gallery image. 0169 left
  it out only because the person dialog was a separate file.
- On a touch screen, an image's select and monochrome buttons always show
  (SLN-380 fixed this in the book dialog only).
- The monochrome button is called "Monochrome settings": it was "Adjust
  image", the same name as the crop and light button beside it.
- A tab lists the active image first, then the newest, as the other owners'
  tabs do (it was oldest first).

Two findings of the checks below, on main too, are fixed here because this
change touches their files:

- The upload zone's "Drag from browser or file system" was `fg-muted/60`
  (contrast 1.56): it is `fg-secondary`, in every media manager.
- A person page without a photo shows the name's first letter; it now takes
  `aria-hidden` and `data-decorative`, as a book's placeholder letter does, so
  the design audit no longer reads it as faint text (1.13).

Nothing else changes on any page: the same labels, classes, toasts and
confirmations. The progress row of the wizard is no longer a component made
during render (a lint warning on main), so it no longer remounts on every
keystroke.

## Completion Notes

TODO
