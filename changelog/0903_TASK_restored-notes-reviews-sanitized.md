# Task 0903: A quote's thought or a review that comes back by Undo is sanitized, and so is every one on its way out

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1239. Every write of a quote's thought and a reading's review ran
`sanitizeCommentHtml`, except the two Undo paths:

- `restoreReadingNote` stored the snapshot's `commentHtml` as sent.
- `restoreReading` took the reading, its sessions and its history as loose
  records and spread them into the insert, `reviewHtml` included.

Both are server actions, so a request could store `<img onerror>` that the
book page, the commonplace book and the passage of the day then render as
HTML.

## Implementation Details

- **Note Undo** (`reading-notes.ts`): a restored quote's thought goes through
  `thought()`, as a new or edited one does: sanitized, and an empty one is no
  thought.
- **Reading Undo** (`reading.ts`): the snapshot schema names each column of
  the reading, its sessions and its history, with its type: uuids, the
  status, format, unit, precision, source and abandon-reason enums, ISO days,
  and timestamps as JSON carries them or as dates. Keys it doesn't name are
  dropped, and a session or history row of another reading is refused. The
  review is sanitized before the insert. The casts through `unknown` are gone.
- **On the way out**, for rows stored before this:
  - `noteRows()` sanitizes the thought of every note `NOTE_COLUMNS` loads:
    the book page, a note's own route, the commonplace book and the passage
    of the day.
  - `cleanReview()` (`service.ts`) sanitizes the review in `loadReading` and in
    the book page's reading overview. The fingerprint stays the stored row's.
  - This is done on the server, so the browser carries no sanitizer. It costs
    about 0.05 ms for a typical thought.

## Completion Notes

- **Integration test** (`reading-notes`):
  - A note restored with `<img src="x" onerror="alert(1)">` stores and returns
    `<img src="x" />`, and so does a reading's review.
  - A reading snapshot with an unknown status is refused, and so is one with a
    history row of another reading. Extra keys (`fingerprint`, `searchText`) are
    dropped.
  - A thought and a review written straight into the table read back clean
    from `getNotesForWork`, `searchNotes`, `loadReading` and the book's reading
    overview.
- **Gates**:
  - `pnpm typecheck` and lint are clean.
  - The reading unit tests pass (579).
  - The database suites `reading`, `reading-notes`, `book-page-reading`,
    `reading-routes`, `reading-sessions`, `reading-hub` and `reading-export` pass.
