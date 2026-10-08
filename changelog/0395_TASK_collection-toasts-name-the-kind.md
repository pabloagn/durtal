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

### Found by the checks, fixed here

The dialogs and toasts this change touches, driven in three browsers, showed
these (main has them too):

- On a touch screen, the collections dialog's rows (40 px), its "Choose
  editions" summary (20 px) and edition rows (40 px), and the New collection
  dialog's "Add a description" (20 px) were under 44 px. They grow to 44 px
  on a coarse pointer; with a mouse nothing changes.
- A toast whose message wraps (as "Collection deleted; some artwork still
  needs cleanup." does) centered its icon on the whole message, 10.5 px below
  its first line. `globals.css` sets the icon on the first line; a one-line
  toast looks as before.
- The activity timeline's "Show more" (on a book's page, under the dialog)
  was 32 px on touch: it is 44 px.
- `scripts/qa/alignment-audit.js` read the collections dialog's title as the
  text beside the book title row's icons, since the book page opens the
  dialog from that row (5 to 8 px "off" at 390 px). It now skips a dialog in
  the row; with the dialog closed the page had no deviation.

## Completion Notes

Built and checked in a cloud container, on main 2f696f56 (with #163):

- `pnpm typecheck` clean; `pnpm lint` 0 errors, 75 warnings, as on main;
  `pnpm deadcode` clean; `scripts/qa/test-local.py` 3,026 of 3,026 tests in
  273 files, none skipped.
- Production build on a disposable database with the synthetic catalogue
  (`preview-local.py --start --seed-large 50`), in headless Chrome 153,
  Firefox 155 and WebKit 26.6 at 1440 and 768 px with a mouse and 390 px with
  touch: `/collections` and its New collection dialog; the collections dialog
  from a perfume (Create & add: "Collection created with this perfume"), a
  film (Add: "Added to collection"), a painting, two books selected in the
  library ("Collection created with these 2 books") and a book's page ("with
  this book"); a collection's page, its delete confirmation and the delete.
  The alignment, design, overflow and touch audits in each state: 135 of 135
  pass, no console errors.
- The delete toasts are covered by the unit test, not seen in the browser:
  the preview keeps S3 objects as files but cannot list or batch-delete them,
  so every collection delete there reports "Collection deleted; some artwork
  still needs cleanup." (unchanged), which the run saw.
- Page weight: every route within budget (`/collections` 79 KB).
- Not run here: `docker build` (GitHub builds the image on the PR).
