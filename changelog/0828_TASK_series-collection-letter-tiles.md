# Task 0828: Series and collections show covers and letters, never blanks

**Status**: Completed
**Created**: 2026-10-18
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-914, from the series and collections survey
(findings/series-collections-survey-2026-10-16.md, item 3 and the empty
collection icon note). Books whose only cover was an edition cover showed
blank tiles in the series Add books dialog and could show none on a series
row; a series with no covers showed a shelf drawing; a collection page's
header showed its letter while its card showed its members' covers; a
collection with no icon showed a shapes placeholder beside its name.

## Implementation Details

- **Series rows** (`seriesWithWorks`, `src/lib/actions/series.ts`) take the
  first edition that has a cover, not the first edition, and fall back to its
  full cover when it has no thumbnail. The list card's query picks the same
  edition (oldest first).
- **Add books dialog** (`searchWorksForSeries`): the poster, else the first
  edition cover; the tile shows the title's `CoverLetter` with none, or one
  that fails.
- **Series card** (`series-card.tsx`): the series' letter when no book has a
  cover. `ShelfSpines` is gone; docs/03, Cards without a photo, says so.
- **Collection page header**: the poster, else the members' covers as on its
  card (`getCollectionCoverPreviews`), else the name's letter.
- **Whole books in a collection** (no edition chosen) show their first
  edition cover when they have no poster, on the member card and in the card
  and header previews.
- **Icon picker** (`collection-icon-picker.tsx`): with no icon the button
  shows the name's letter, faint, as a blank cover does.

## Completion Notes

- Database tests: a series row, list card and Add books result take a book's
  second edition's cover when the first has none; a whole book in a
  collection previews its edition cover.
- Checked /series, a series page, its Add books dialog, /collections, a
  collection page and an empty collection at 1440, 390 and 320 with covers,
  edition-only covers and none: no blank tile or shelf drawing remains.
  Audits clean in Chromium, Firefox and WebKit; page weight passes.
