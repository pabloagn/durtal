# Task 0309: Up Next queue

**Status**: Completed
**Created**: 2026-10-05
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0305 (SLN-448), 0306 (SLN-449), 0307 (SLN-450), 0308 (SLN-451)
**Blocks**: Reading tracker steps 9 to 15 (SLN-442)

## Overview

Step 8 of 15 of the reading tracker (SLN-442, sub-issue SLN-452). "What I
want to read next" is its own ordered list, separate from what Joris wants to
buy. He adds a book from anywhere, reorders by dragging or by keyboard, sees
which books are at hand where he is and how long the list would take at his
pace, and starts one in a tap; starting a book takes it off the list.
To-read shelves from Goodreads and StoryGraph land here. Up Next never
changes `catalogue_status`. Migration 0068 adds `reading_queue`.

## Implementation Details

- Migration `0068_reading_queue.sql`: `reading_queue` (`work_id` unique and
  cascade, `edition_id` set null, `position` with gaps of 1024, `note` of at
  most 500 characters, `source` manual, import or suggestion, `import_id`,
  `source_key` unique, `added_at`), an index on `position`,
  `book_parent_required`, and `guard_reading_queue`: an edition is checked
  only when set and new, changed or moved with its row, so an edition delete
  and a renumber never raise. The migration and book-isolation tests list the
  table.
- Consistency: `readingQueueMergeQueries` (`src/lib/harmonization/
  reading-queue-merge.ts`) keeps the earlier of two queued books when they
  merge; `updateEdition` clears a moved edition from the old book's row;
  `moveToExistingEdition` carries a placeholder's; `createReading` and
  `writeReadings` (an open or paused row) take the book off Up Next in the
  same write and say `unqueued: true` ("Started Nadja · removed from Up
  Next").
- Actions (`src/lib/actions/reading-queue.ts`): `addToQueue`,
  `addManyToQueue`, `removeFromQueue` and `restoreQueueItem`,
  `moveQueueItem` (the middle of the gap, else a full renumber in the same
  write), `updateQueueItem`, `getQueue` (one query: editions and copies,
  each edition's last audio length, ownership, the copy at hand, the reading
  history), `getQueueHead`, `getQueuePlace`. `work.queued` and
  `work.unqueued`, at most one each per book per reading day. Pure rules in
  `src/lib/reading/queue.ts`: positions, the edition he means, where the copy
  is, time to read at his prior, the summary.
- `/reading/next` and the Up next tab: the summary ("14 books · about 96
  hours at your pace", pages only before any timed session), rows with where
  the copy is and time to read, Start reading with the queued edition, Move
  to top, Move up, Move down and Remove with Undo, `@dnd-kit/sortable`
  dragging and keyboard lifting with a live region ("Nadja moved to position
  2 of 14"), the "At hand in Amsterdam" filter, and the empty state's "Add
  from your library".
- Elsewhere: the book page's reading control and actions menu ("Add to Up
  Next", "In Up Next, 3rd · Remove"), `R N`, the library's bulk toolbar
  ("Added 5 · 2 already in Up Next · 1 being read"), the Reading filter value
  `queued` and the sort `queue` (page, timeline and `GET /api/works`), the
  hub's Up next strip, and the palette's "Go to Up next".
- Import: Goodreads (`Exclusive Shelf` to-read, with or without a Book Id)
  and StoryGraph (`Read Status` to-read) rows get an Up Next key and their
  Date Added. Matched ones go to a Want to read section that notes "Already
  in Up Next, at 3", "Being read now" or "Read in 2019"; unmatched ones wait
  under Not in Durtal or To choose. The commit adds them oldest first, never
  twice, and skips books queued or started meanwhile; undo removes the items
  still where it put them. A re-uploaded file whose readings are in offers
  "Add 412 books to Up Next".
- Fixed on the way: the library's bulk toolbar wraps and stays inside a
  narrow screen (it ran 216 px past each side at 768 px); a long estimate
  part ("Log a few sessions for an estimate") wraps so a hub card never
  widens past its column at 390 px (also pushed to SLN-451's branch).
- Docs 02 (the table, its guard, the merge rule), 04 (`/reading/next`, the
  tab, the library filter value and sort, the import's Want to read section),
  05 (`reading=queued`, `sort=queue`) and 06 (the actions, the service's
  `unqueued`, the import's commit and undo).

## Completion Notes

- Tests: `scripts/qa/test-local.py` (every suite, a disposable PostgreSQL 16):
  198 files and 2,225 tests, none skipped, after two fixes the full run
  found: the import suite now expects the Up Next counts in its commit and
  undo results, and SLN-451's forgotten-timer test ends its timer the same
  half minute after its start (a clock skew had rounded 90.5 minutes to 91).
  New: the database suite `reading-queue` (19: add, refuse, remove and
  restore, moves and the renumber, starts, merges, the edition guard with
  deletes, moves and placeholders, `getQueue`'s whereabouts, the library
  filter and sort with `GET /api/works`, and to-read shelves with their
  commit, re-import and undo), the unit suite `queue` (6) and the component
  suite `up-next` (6). `pnpm typecheck`, `pnpm lint` (no error, no warning in
  a changed file) and `pnpm deadcode` are clean.
- Migration rehearsal: the preview from the backup applies 0068 with the
  same result as main (only 0065's `works` rating type differs, 24 rows).
  I apply 0068 after the merge.
- Page weight on a production-build preview: every route within budget;
  `/reading/next` with 40 books 205 KB in 15 ms; `/` 256 KB, `/library` 299
  KB (299 on SLN-451's preview), `/reading` 122 KB with the Up next strip,
  `/reading/import/*` 67 KB.
- Browsers, all headless, never a window: Chrome, Firefox and WebKit (Safari's
  engine, through playwright-core) at 1440, 768 and 390 px: `/reading/next`
  empty, with 3 and with 40 books, the At hand filter, the row menu, the
  hub's strip, the book page's menu ("In Up Next, 1st · Remove R N"), the
  bulk toolbar and the import preview's Want to read section. No alignment
  deviation over 0.5 px, no unnamed control, no overflow, no console error
  in Chrome and Firefox; WebKit's console errors are the covers the preview
  has no S3 image for. Dragging a row by its handle in WebKit and in
  Chromium saves the new order (it holds after a reload); lifting a row with
  Space and the arrows saves it too (the journey). Safari itself was not
  driven: safaridriver opens windows on Joris's screen.
- Journeys on a production-build preview: `reading` passes with its new
  steps (three books added from the library's bulk toolbar, the third lifted
  to the top by keyboard and the order kept after a reload, the top one
  started and gone from Up Next) and `import` passes (a to-read book in Want
  to read, committed into Up Next, gone after Undo, back after the second
  commit, and "Already in Up Next" on a second upload).
