# Task 0996: Reading statistics in a quarter of a second on a long reading history

**Status**: Completed
**Created**: 2026-10-19
**Priority**: HIGH
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-1309, from findings/query-indexes.md (items 1.1 and 1.2). On 4,000 readings /reading/stats took about 3 s, almost all of it JIT compiling plans whose cost estimates passed `jit_above_cost` but which run in milliseconds.

## Implementation Details

- **`activeIn`** (`src/lib/reading/stats.ts`) reads `reading_sessions` instead of the `ss` CTE. A CTE read more than once is materialised without an index, and probing it once per reading planned the year's numbers at 1.4 million. `reading_session_reading_idx` serves the new probe, with the same running-timer filter as `ss`.
- **No JIT for the stats batch.** `batchedRows` (`src/lib/db/read-batch.ts`) takes `{ jit: false }` and heads each request of the wave with `set local jit = off`, which holds for that request's own transaction only. A lone read without JIT still goes as a batch so the setting applies. Every stats read asks for it. Nothing changes JIT for the database or the role.
- **`readingRatingOverAllSql`** (`src/lib/reading/summary.ts`) counts a book's finished reads with a window, not a subquery per row. It is used where the rows hold every reading, before any filter: the stats base and the journal base. `getRecentlyFinished` keeps `readingRatingSql`, since it reads only finished readings and a few rows.
- **Re-read ratings** (`ratings`): each book's finished reads are counted once in a grouped CTE, not by two scans of `rr` per book. After the first three changes this query was the slowest left, at 203 ms.
- `scripts/qa/seed-reading-scale.sql`: 4,000 readings and 12,000 sessions on top of the scale seed, for checking this again.

## Completion Notes

Preview at scale (seed-scale-valid.sql plus seed-reading-scale.sql: 5,000 books, 4,004 readings, 12,000 sessions), production build, three runs after two warm-ups:

| Page | Main, 0 / 40 / 200 ms | Now, 0 / 40 / 200 ms |
| --- | --- | --- |
| /reading/stats | 2.58-2.79 / 2.51-2.78 / 2.75-2.93 s | 0.22-0.26 / 0.21-0.30 / 0.37-0.39 s |
| /reading/stats?year=2024 | 2.41-2.56 / 2.60-2.97 / 2.62-2.77 s | 0.20-0.29 / 0.24-0.32 / 0.39-0.43 s |
| /reading/year/2024 | 2.56-2.96 / 2.54-2.86 / 2.91-3.29 s | 0.19-0.22 / 0.29-0.35 / 0.59-0.63 s |
| /reading/journal | 0.12-0.15 / 0.20-0.22 / 0.51-0.52 s | 0.12-0.13 / 0.20-0.21 / 0.51-0.56 s |
| /statistics | 0.15-0.21 / 0.26-0.29 / 0.55-0.58 s | 0.13-0.15 / 0.20-0.23 / 0.51-0.55 s |

- The stats' database work now spans 158 ms (39 statements in five requests side by side). The slowest statement left is the unread pile's count of books at hand by home (45 ms alone), which reads the catalogue, not the readings.
- **Same numbers.** Both builds served the same database (a dump of main's restored for the fix). The markup of /reading/stats for all time and each year from 2018 to 2026, every Year in review, the journal's pages and /statistics is identical, apart from bar widths on "Pages an hour" differing in the 15th significant digit: the float sums run in a different order. No shown number changes.
- **Tests:** `reading-stats.test.ts` checks that the window rating matches the per-row count on every reading, and that `activeIn` from the table matches the CTE in each year (including a reading with only a running timer). `read-batch.test.ts` covers the JIT-off requests.
- `page-weight.js` on this preview: /reading/stats 243 ms, /reading/year/2026 219 ms, /statistics 170 ms, the journal 137 ms. /reading and /reading/suggestions go over 1 s on 4,000 readings because of the suggestions' book query (514 ms), which this change doesn't touch; /harmonize is over at scale as before.
- `pnpm typecheck` clean, `pnpm lint` 0 errors (81 warnings, the baseline), `pnpm test` 6,998 passed; reading-stats, reading-hub and reading-export database suites pass.
