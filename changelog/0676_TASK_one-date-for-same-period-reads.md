# Task 0676: One date for a read that starts and ends in the same period

**Status**: Completed
**Created**: 2026-10-18
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-929, item 6 of `findings/reading-tracking-survey-2026-10-16.md`. A read started and finished on the same day, month or year repeated itself on the book page, the journal and import previews: "16 to 16 Oct 2026", "Oct 2026 to Oct 2026", "2019 to 2019". With mixed precision it read "May 2020 to 2020" or "2021 to Feb 2021".

## Implementation Details

`formatReadingSpan` (`src/lib/reading/dates.ts`) compares the two dates at the coarser of their precisions. When they fall in the same period:

- the same precision gives the date once: "16 Oct 2026", "Oct 2026", "2019";
- a finer finish gives the finish alone, which already says when the read began: "Finished Feb 2021", "Finished 14 Apr 2019";
- a finer start follows the finish: "Finished 2020, started May", "Stopped 2020, started 3 May".

Spans across periods are unchanged ("15 to 16 Oct 2026", "2019 to 2020", "May 2020 to 2021").

## Completion Notes

- `reading/dates.test.ts` covers each case; the journal and import preview tests pass unchanged.
