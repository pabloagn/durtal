# Task 0482: E-book library ratings and reads

**Status**: Completed
**Created**: 2026-10-13
**Priority**: HIGH
**Type**: Feature
**Depends On**: 0481 (Import existing), SLN-450 (reading import)
**Blocks**: SLN-498 (the load)

## Overview

SLN-658, part 2. The e-book library's ratings and read dates come in as a
reading import, next to Goodreads and StoryGraph, for the books that are
linked e-books in Durtal. Nothing reaches a book until Joris commits the
import, and every conflict shows in its preview. Parts 1 (metadata
differences) and 3 (tags) follow in their own change.

## Implementation Details

- `src/lib/ebooks/calibre/reading.ts`: `requireReadColumns` checks the named
  columns against the snapshot, and `calibreReadingRows` makes one import row
  for each linked book with a rating or a read, numbered by the library's
  book id. A read date is the calendar date in Durtal's time zone.
  `linkedCalibreBooks` reads the linked e-books of one library.
- `pnpm ebooks:reading-import` (`scripts/ebooks/reading-import.ts`) counts, or
  with `--create` makes the import. A database that is not a preview also
  needs `--live`.
- Reading import:
  - Source `ebook_library`, labelled "E-book library": Durtal names no
    outside tool in its screens (SLN-490). Its source keys are
    `ebook-library:<library id>:<book uuid>#1`.
  - `ImportMatch.rating` is `set`, `differs` or `same`. A row whose reads are
    all present but whose rating is to settle stays importable; a same rating
    with every read present is present.
  - `commitLibraryRatings` settles each committed row's rating in one
    statement: it writes the file's rating when the book has none, or when
    the row says to use the file's, and journals it as `bookRating` with
    `ratingOutcome`. Undo restores it as for Goodreads.
  - The summary counts `toRate`; the commit button and the import list count
    ratings; the Undo dialog names only what the import wrote.
- Docs: `02_DATA_MODEL.md` (`ebook_library`, `ratingOutcome`) and
  `09_INGESTION_PIPELINE.md` ("Ratings and reads").

## Completion Notes

- The database suite `reading-import.test.ts` adds two cases: five library
  books (a new read, a present read, a different rating, a new rating, a
  disagreement) through preview, commit, a second commit, a second import and
  undo; and Durtal's rating kept unless the row says to replace it.
- Unit tests: `ebooks/calibre/reading.test.ts` (rows, time zone, the columns'
  refusals) and `reading/import-preview.test.ts` (sections and lines).
- `/reading/import` and an e-book library import were checked on the
  production build in headless Chrome, Firefox and WebKit at 1440, 768 and
  390 px, with the audits clean, and `scripts/qa/page-weight.js` passed.
- No migration and no new package.
