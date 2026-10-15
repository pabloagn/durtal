# Task 0701: Statistics follow-ups: covers on the dashboard, countries to their books

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0700
**Blocks**: None

## Overview

The review's suggestions for the Statistics section and page (SLN-742): the
dashboard section shows covers, the busiest years show pictures before
blanks, the Decades view no longer leaves most of its width empty, a country
opens the books it counted, and the two statistics pages explain and link to
each other (SLN-775).

## Implementation Details

- Dashboard section (`src/components/statistics/dashboard-statistics.tsx`):
  under the number tiles, the year with the most books with five of its
  covers (`YearCovers`, shared with `/statistics`, captioned "Most books from
  one year"); the loading skeleton holds its place.
- `busiestYears` orders each year's books by having a cover, then rating; a
  blank cover is the title's letter, sized like the shared blank (#352).
- `decadeBuckets` walks back from the newest decade and stops at a run of
  more than eight empty decades (or 60 decades); older books are one
  "Before …" bar.
- New library filter `authorCountry` (ISO alpha-2): a work with a writer
  (author or co-author, not a translator) from that country. Parsed in
  `filter-params.ts`, applied in `filter-conditions.ts`, counted in
  `getLibraryFilterOptions` and shown in the panel as "Author's country"
  under Book; its chip names the country before the options load.
  "Authors from" on `/statistics` links there instead of to People.
- `/statistics` Reading block: a footnote on why its books finished can
  exceed Read in the Breakdown. `/reading/stats` links back ("Library
  statistics" on its numbers section).

## Completion Notes

- No migration, no new package.
- Tests: `charts.test.ts` (the gap rule), `filter-params.test.ts` (the
  country codes), `library-filters.test.ts` (a translator's country does not
  count; option counts) and `library-statistics.test.ts` (covered books
  first).
- Checked on a production preview of a disposable seed in Chromium, Firefox
  and WebKit at 1440, 1024, 390 and 320: `/`, `/statistics`,
  `/reading/stats` and `/library?authorCountry=FR`. "France, 33 books" opens
  33 books.
