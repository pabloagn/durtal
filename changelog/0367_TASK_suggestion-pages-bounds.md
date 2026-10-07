# Task 0367: The suggestion engine reads pages by the page rule's bounds

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Fix
**Depends On**: 0352
**Blocks**: None

## Overview

SLN-520, found while building SLN-466. The suggestion engine's `bookPages`
returned the page count of the edition to be read, whatever its value. The
page rule (`src/lib/enrichment/pages.ts`, docs/02 "Pages of a Work") leaves a
count outside 16 to 3,000 pages out as not usable, so the two disagreed about
the same edition: a 3,980-page edition on the 6 Oct backup would have been a
long book to the suggestions and a book of unknown length to the page rule.

## Implementation Details

- `bookPages` (`src/lib/reading/suggest/build.ts`) returns null for a count
  outside `MIN_PAGES` to `MAX_PAGES`, imported from `src/lib/books/enrichment.ts`.
  A null already means "unknown": the length feature ignores it, and it passes
  only the "any" length filter (`passes` in `score.ts`).
- The suggestion row (`suggestionRow`, `view.ts`) reads the same pages: for a
  count outside the bounds it shows no page count and no time to read, as for
  a book with no count. An audio length is shown as before. Up Next's time to
  read (`timeToRead` in `queue.ts`) is not changed.

## Completion Notes

- `src/__tests__/reading/suggest.test.ts`: a new case reads 3,980 and 15 pages
  as unknown and keeps 16 and 3,000; the long and short filters leave the two
  unknown books out, and "any" keeps all four. The suggestion row shows no
  length and no time for 3,980 pages, and "3000 p." with its time for 3,000.
  28 tests pass.
- No layout change: the suggestions and their rows differ only for a book
  whose edition has a count outside the bounds.
- `scripts/qa/test-local.py`: 254 files, 2,835 tests, all passed. Typecheck
  clean; lint no new warning; `pnpm deadcode` clean.
