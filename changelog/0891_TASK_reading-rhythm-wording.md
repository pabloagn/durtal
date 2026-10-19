# Task 0891: The reading rhythm reads right at any target, and this year counts weeks so far

**Status**: Completed
**Created**: 2026-10-16
**Priority**: LOW
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-923, from finding 3 of `findings/settings-survey-2026-10-16.md`.

- The year review said "22 weeks had 1 reading days or more".
- The Reading page's week line said "5 of 3 days this week" past the target,
  and "5 of 1 day this week" with a target of 1.
- The current year's review counted every week the year touches, future
  ones too: "in 22 of 53 weeks" on 16 October.

## Implementation Details

- `rhythmWeekText` (`src/lib/reading/goals.ts`): up to the target, "2 of 3
  days this week"; past it, "5 days this week" with "3 is the aim" on a quiet
  line under it (`rhythm.tsx`).
- `yearRhythm` (`src/lib/reading/charts.ts`) takes today's reading day. In
  the year holding it, only the weeks up to today's week count; a past year
  keeps all its weeks. The year page passes the reading day from the app's
  time zone and day start, as the stats page does.
- `yearRhythmText` (`charts.ts`) is the review's sentence, with plurals for
  days, weeks and the target ("1 reading day or more"). It moved out of the
  page so it can be tested.

## Completion Notes

- **Unit tests.** `rhythmWeekText` below, at and past targets of 1 and 3;
  `yearRhythm` up to 16 October 2026 (42 weeks, for weeks from Monday and
  from Sunday), on 1 January (1 week) and for a past year (53, unchanged);
  `yearRhythmText`'s plurals.
- **In the browser** (survey dump; targets set through Settings > Reading):

  | Days this week | Target 1 | Target 3 |
  | --- | --- | --- |
  | 1 | 1 of 1 day this week | 1 of 3 days this week |
  | 2 | 2 days this week / 1 is the aim | 2 of 3 days this week |
  | 3 | 3 days this week / 1 is the aim | 3 of 3 days this week |
  | 4 | 4 days this week / 1 is the aim | 4 days this week / 3 is the aim |

  The 2026 review reads "in 22 of 42 weeks; 22 weeks had 1 reading day or
  more" (9 weeks at a target of 3); 2025 keeps 53 weeks.
- **Audits.** The browser audit passes 36 of 36 loads of `/reading` (with
  the aim line showing), `/reading/year/2026` and `/reading/year/2025` at 1440, 1024, 390 and 320
  in three browsers. Page weight after rebasing on main: `/reading` 173 KB and 145 ms,
  `/reading/year/2026` 100 KB and 272 ms; every route is within budget.
