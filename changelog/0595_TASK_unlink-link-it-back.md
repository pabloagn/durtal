# Task 0595: Link it back after an unlink

**Status**: Completed
**Created**: 2026-10-15
**Priority**: LOW
**Type**: Enhancement
**Depends On**: 0516
**Blocks**: None

## Overview

SLN-684's last item: linking offers Undo, unlinking did not. An unlink now
offers "Link it back", which opens Choose a book on the eBook's page with
its old book already chosen, so linking it again takes a preview and a
confirmation.

A true Undo of the unlink was left out on purpose. An unlink runs the same
receipt-checked writer as a link's Undo (`undoLink`) and deletes the copy
and any edition, book, author or series made only for that link; undoing it
would mean re-creating the original link from its receipt, a new writer in
the review core (which reports `unsupported_undo` today) with its own
transaction tests. The unlink stays a danger button (Enter alone never
presses it), and its preview names what it removes.

## Implementation Details

- `loadReviewUnlinkTarget` also reads the book the eBook is linked to
  (`ReviewUnlinkTarget.book`); the review queue fills it from its row.
- `unlink-ebook-dialog.tsx`: after an unlink that returns the eBook to
  review and keeps its book (the preview removes no book), the dialog offers
  "Link it back" beside Done, and the preview says so ("Afterwards, Link it
  back chooses “The Cathedral” again."). Link it back closes the dialog and,
  from a book page or the review queue, opens the eBook's page.
- `choose-book-next.ts` carries the book to start on; `EbookLinkControls`
  passes it to `ChooseBookFields` (`startWorkId`), which opens on that
  book's editions instead of a search.
- Choose a book gains "Choose another book" beside the chosen book's title,
  back to the search (run then, when it opened on a book).

## Completion Notes

- On a disposable preview with local S3: an eBook linked through Choose a
  book, then unlinked from its book page, "Link it back", Preview link and
  Confirm decision: linked again to the same book, in Chromium at 1440 and
  WebKit at 390.
- Tests: `unlink-ebook-dialog` (Link it back offered and carried to the
  eBook's page; not offered when the unlink removes the book or the book is
  unknown), `review-dialogs` (Choose a book opens on a book and goes back to
  a search), `review-queue` (the target's book).
- No migration, no new package.
- Review fix: on the eBook's own page, Link it back opened nothing (its link
  controls were already showing it unlinked and never took the choice, which
  then popped up later after leaving and coming back). `chooseBookNext` now
  tells subscribers when a choice is set, and `EbookLinkControls` listens
  while mounted, so Choose a book opens at once on the old book. "Choose
  another book" keeps focus in the dialog, on the search field.
