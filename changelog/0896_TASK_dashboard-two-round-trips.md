# Task 0896: The dashboard reads in two round trips, Statistics among them

**Status**: Completed
**Created**: 2026-10-18
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-795, with finding 1 of `findings/scale-recheck-2026-10-18.md`. At the
5,000-book scale with each database request held 200 ms, the dashboard took
1,142 ms in 5 round trips. Its Statistics section only started once the
rest of the dashboard was in, then took two round trips of its own. The
library's figures waited for the wanted shelf's ids before their own reads
went out, and the e-book marks, author covers and roles waited for all of
them.

## Implementation Details

- **Statistics** (`dashboard-statistics.tsx`): `statisticsReads()` starts the
  section's reads, with the busiest year's covers as soon as the years are
  in. The dashboard calls it before it waits on anything and hands the reads
  to `DashboardStatistics`, which still loads in its own Suspense boundary.
- **The library's reads** (`libraryStatsReads`,
  `src/lib/actions/utils/library-stats.ts`, moved out of `getLibraryStats`):
  the counts and the recent, highest rated and people shelves, the wanted
  shelf's ids in alphabetical order, and the wanted shelf's cards, each its
  own promise, all started at once. `getLibraryStats` awaits them and returns
  what it did, in the same order, for `/api/stats`.
- **The dashboard** (`page.tsx`): the e-book marks wait for the shelves and
  the wanted ids, not the wanted cards, so they go out with those cards. The
  author covers and roles wait for the shelves alone.
- `readingExtras` moved to `work-card-query.ts`, beside the other card
  extras, so the new module and `works.ts` share it.

## Completion Notes

- **Timing** (production build, 5,000-book scale seed, median of 7 after two
  warm-ups):

  | Held per request | Main | This change |
  | --- | --- | --- |
  | 0 ms | 220 ms | 141 to 155 ms |
  | 40 ms | 347 ms | 186 to 204 ms |
  | 200 ms | 1,142 ms | 499 to 532 ms |

  A trace at 200 ms shows the same 32 requests in 2 round trips, not 5.
- **The same page.** Main and this change, each on a preview restored from
  the same dump of the scale seed, give the same text, the same 46 images and
  the same 112 links on the dashboard (Chromium, 1440).
- **Tests.** `statistics/dashboard-reads.test.ts`: Statistics' reads start at
  once and the busiest year waits only for the years (fails on main's
  component); the dashboard starts them before its first wait. The dashboard
  and statistics unit tests pass, and the 5 database suites that call
  `getLibraryStats` pass (59 tests).
- **Audits.** The browser audit passes 12 of 12 loads of `/` at 1440, 1024,
  390 and 320 in three browsers. Page weight: `/` is 284 of 300 KB and
  149 ms at the scale seed. `/harmonize`, `/reading` and
  `/reading/suggestions` are over their time budget at that scale, as on main
  (the last two are SLN-934's).
