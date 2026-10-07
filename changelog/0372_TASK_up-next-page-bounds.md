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

The test fails without the change in `queue.ts`. The edition data is not
changed: the count stays as it is until the edition is corrected.
