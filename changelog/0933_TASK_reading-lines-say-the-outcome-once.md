# Task 0933: Reading lines say the outcome once

**Status**: Completed
**Created**: 2026-10-18
**Priority**: LOW
**Type**: Fix
**Depends On**: 0932
**Blocks**: None

## Overview

SLN-1098 (item 2 of SLN-1075) and SLN-1099.

- A Journal row and a book page's earlier read named the outcome twice: "Finished 27 Nov 2024 · Finished", and on the book page "Finished 27 Nov 2024" over "Finished".
- The import preview dropped "Abandoned" from an abandoned read whose span had no leading "Stopped": one date ("14 Apr 2019") or two periods ("3 to 14 Apr 2019") read as a finished read.

## Implementation Details

- `lib/reading/dates.ts` `formatReadingSpan` takes `{ bare: true }` for a line that names the outcome after the span. It then leaves out the leading "Finished" or "Stopped": "27 Nov 2024", "Feb 2021", "2020, started 3 May". Without it nothing changes.
- The Journal row (`reading/(tabs)/journal/page.tsx`) and the book page's earlier reads (`components/reading/reading-section.tsx`) pass it. The outcome stays where it was: "27 Nov 2024 · Finished", and "Finished" or "Abandoned at p. 120" on the book page's second line.
- `lib/reading/import/preview-text.ts` `readingWords`: an abandoned span that starts with "Stopped" still becomes "Abandoned 14 Apr 2019"; any other gets "Abandoned, " before it: "Abandoned, 3 to 14 Apr 2019", "Abandoned, Dec 2018 to Feb 2019".

## Completion Notes

- Tests: `reading/dates.test.ts` (the bare span for finish-only, coarser-start, abandoned and two-period reads) and `reading/import-preview.test.ts` (an abandoned read with one finish date, one day, two days, two months and no date).
- Browser, in Chromium, Firefox and WebKit, on a seeded preview after importing a StoryGraph and a Goodreads file through the app:
  - The import preview read "Abandoned, 3 to 14 Apr 2019", "Abandoned, 14 Dec 2018" and "Abandoned, 5 Jan 2023 to 10 Feb 2024".
  - The Journal read "27 Nov 2024 · Finished", "4 Mar 2021 · Finished" and "5 Jan 2023 to 10 Feb 2024 · Abandoned".
  - The book page's earlier read read "1st read 4 Mar 2021" over "Finished".
  - The alignment and design audits are clean on the Journal, both book pages and the import preview at 1440, 390 and 320.
- Page weight passes on every route.
