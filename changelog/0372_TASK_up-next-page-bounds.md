# Task 0372: Up Next reads a page count outside 16 to 3,000 as unknown

**Status**: Completed
**Created**: 2026-10-07
**Priority**: LOW
**Type**: Fix
**Depends On**: 0367
**Blocks**: None

## Overview

SLN-533, a follow-up to 0367 (SLN-520). 0367 made the suggestion row read
an edition's page count only inside 16 to 3,000 pages, the bounds the
enrichment check uses. Up Next (`/reading/next`) still read any count, so a
book whose edition says 3,980 pages showed "3980 p." and about 132 hours to
read.

## Implementation Details

- `timeToRead` (`src/lib/reading/queue.ts`) returns no length for a page
  count under `MIN_PAGES` (16) or over `MAX_PAGES` (3,000), from
  `src/lib/books/enrichment.ts`. An audio length still counts first.
- The Up Next row (`src/app/reading/next/page.tsx`) takes its length from
  that time, so the page count and the hours follow one rule. A book with a
  bad count shows neither, and the list summary counts it as one "without a
  length".
- One test in `src/__tests__/reading/queue.test.ts`: 3,980 pages gives no
  length and 3,000 pages gives a time.

## Completion Notes

- The new test fails without the change in `queue.ts`.
- The edition data is not changed: the count stays as it is until the edition
  is corrected.
- Production builds of main (df183f02) and this branch on the newest backup.
  The backup's Up Next is empty, so the preview's database (local, thrown
  away after) got three books in Up Next: Under the Volcano with its edition
  set to 3,980 pages, Stella Maris set to 3,000, and The Book of Disquiet at
  its own 560 pages. No timed session, so the pace is the default 30 pages an
  hour.
  - Main, Chrome at 1440 px: "3980 p. · On your shelf in Amsterdam · About
    132 h 40 min", "3000 p. · … · About 100 h", "560 p. · … · About 18 h 40
    min". The summary reads "3 books · 7,540 pages".
  - This branch, in headless Chrome, Firefox and WebKit at 1440 px and at
    390 px with a coarse pointer: Under the Volcano reads "On your shelf in
    Amsterdam" only; the other two rows are unchanged. The summary reads "3
    books · 3,560 pages · 1 without a length".
  - The alignment, design and overflow audits find nothing. `page-weight.js`
    passes (`/reading/next` 57 of 300 KB, 7 of 1,000 ms).
- Typecheck clean. Lint: no new warning. `pnpm deadcode` clean.
- `scripts/qa/test-local.py`: 259 files, 2,930 tests, all passed.
