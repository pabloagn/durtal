# Task 1001: The reading journal hashes only the readings it shows

**Status**: Completed
**Created**: 2026-10-19
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0996 (SLN-1309)
**Blocks**: None

## Overview

SLN-1311, from the query-indexes survey (findings/query-indexes.md, item 1.5). The journal's `base` computed `md5(to_jsonb(r)::text)`, every reading's fingerprint, for all readings before the filter, the sort and the `limit 48`. Only the page's rows need one.

## Implementation Details

- `lib/reading/journal.ts`:
  - `base` no longer carries the fingerprint.
  - The list's outer select reads it through `readingFingerprintSql(b.id)` (`lib/reading/service.ts`), the same md5 of the whole row that the stale-save checks compare.
  - PostgreSQL runs that subquery after the sort and the limit: 48 loops on a page of 48 (seen in `explain (analyze, verbose)`).
- The summary and the export never read the fingerprint, so nothing changes there. The planner already dropped the unused column from them.

## Completion Notes

- Database time of the list query on the scale seed plus `seed-reading-scale.sql` (4,004 readings), JIT off as Neon runs it: 118-131 ms before, 24-43 ms after.
- Server time of /reading/journal, at 0 / 40 / 200 ms a query:
  - Now: 0.09-0.12 / 0.14-0.16 / 0.46-0.47 s.
  - Main, from the #556 review on 4,009 readings: 0.12-0.16 / 0.20-0.32 / 0.49-0.54 s.
  - Sorted by rating: 0.07-0.09 / 0.13-0.15 / 0.46-0.47 s.
- `page-weight.js`: /reading/journal 240 KB, 66 ms. Only /harmonize fails (2.3 s); this change does not touch it.
- Test (`reading-hub.test.ts`): every journal row's fingerprint equals `md5(to_jsonb(r))` of its reading. A save with a row's fingerprint goes through; once the reading has changed, the same fingerprint is refused with the stale-reading message.
