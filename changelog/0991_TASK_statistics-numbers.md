# Task 0991: The statistics' numbers say what they mean

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1173, from the statistics survey (findings/statistics-survey-2026-10-18.md, items 2, 6, 7 and 8). On /reading/stats the Average rating tile snapped to a half star ("3" for 2.77), Hours read "0" when nothing was timed, the finish-rate insight wrote "2823 finished, 0 abandoned" and "10 of 10" for any rate from 95%, and All time stated the undated count three times, as books and as readings.

## Implementation Details

- `lib/utils/rating.ts`: `formatAverageRating`, an average to one decimal ("2.8"). The Average rating tile and the recommenders' "… on average" line use it; `formatRating` stays for single ratings.
- `components/reading/stats-parts.tsx`: `hoursTile`. With no session timed the Hours tile is a dash, as 0 pages is, and a screen reader hears "Not timed"; under half an hour it reads "Under 1". Used on /reading/stats and the Year in review. `NumberTiles` takes a tile's `spoken` text for a value drawn as a dash.
- `lib/reading/insights.ts`: every insight's counts group thousands. The finish-rate insight shows only when something was abandoned; below 95% it says "9 of 10 books", from 95% a percentage rounded down ("99% of the books"), so an abandoned book never reads as all of them (`finishShare`).
- The undated count is said once, under the numbers, as "finished readings"; the two Over the years charts no longer repeat it. `overTheYear` drops the query that counted them for those footnotes.

## Completion Notes

- Preview with the reader seed plus 31 rated finish-only readings in 2026, 3 undated finished readings and one abandoned book: 2026 shows Average rating 2.7 and Hours as a dash; All time shows 3.1, "3 finished readings with no known date are in the totals, in no chart." once, and "You finish 98% of the books you start" with "66 finished, 1 abandoned".
- Alignment audit on /reading/stats (2026 and All time) and /reading/year/2026, three browsers at 1440, 390 and 320: 0 issues, overflow 0.
- `page-weight.js`: exit 0.
- Tests: `src/__tests__/reading/stats-charts.test.ts` covers the average, the Hours tile, the finish-rate condition and wording, and grouped counts; `pnpm test` passes.
