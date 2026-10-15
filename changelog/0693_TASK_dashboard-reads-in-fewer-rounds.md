# Task 0693: The dashboard reads in fewer rounds

**Status**: Completed
**Created**: 2026-10-15
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: None
**Blocks**: None

## Overview

SLN-795, from the speed survey (`findings/speed-survey-2026-10-15.md`, item
2). The dashboard waited on the database five times in a row. Every follow-up
read (e-book availability, collection covers, people's covers and roles,
reading estimates, the goal) waited for all the first reads, including the
other collections' newest records, which themselves read their counts first
and then their records.

## Implementation Details

- `src/app/(catalogue)/page.tsx`:
  - each follow-up read starts from the one read it needs: availability and
    people's covers and roles from the library stats, collection covers from
    the collections, estimates from the open readings;
  - `otherDomains()` reads each collection's counts and newest records side
    by side.
- No batching: requests stay at 28, sent in parallel.

## Completion Notes

Production build, local preview from one database dump (synthetic catalogue,
reader fixtures, 20 demo books, the reading journey), on main with the
Statistics section and full-row shelves. Each HTTP request to the database
held 40 ms or 200 ms (one Neon round trip):

| `/` | Rounds | 40 ms | 200 ms |
| --- | --- | --- | --- |
| main | 5-6 | 0.35-0.36 s | 1.30 s |
| this change | 3-4 | 0.24-0.25 s | 0.88-0.89 s |

The rendered page, after streaming, matches main's (the body's HTML compared
with attributes sorted, and ids, cache-busting numbers, React's generated ids
and image retry counts normalised). Browser audit 9 of 9 (Chromium, Firefox,
WebKit at 1440, 390, 320); `/` is 220 of 300 KB before the shelves change.
