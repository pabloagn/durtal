# Task 0346: /series suggestions without JIT

**Status**: Completed
**Created**: 2026-10-06
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

SLN-487. Postgres JIT-compiled the series suggestion query
(`getSeriesSuggestions`, `src/lib/actions/series.ts`) on every `/series`
request once the planner had fresh statistics. The planner guesses 1,000
rows for each `regexp_split_to_table` call, so 85 series made a cost far over
`jit_above_cost` (100,000), and the compile took longer than the query.

## Implementation Details

- The title split is now `unnest(regexp_split_to_array(...)) with
  ordinality`: the same parts in the same order, but the planner guesses 10
  parts a title, so the cost falls a hundredfold. No setting, function or
  migration changes; JIT stays on for the database.
- Test in `series.test.ts`: with 85 series and 700 books with their authors
  (the size of the backup in the ticket), after `analyze`, `explain` of the
  query the app sends costs less than the database's `jit_above_cost`. It
  fails on the old query.
- The suggestion engine's book query (SLN-457), the ticket's second query, is
  not on main yet; the coordinator passed the same fix to that thread.

## Completion Notes

Measured on disposable previews (Postgres 16, `jit = on`, `jit_above_cost`
100,000), after `analyze`:

| Series | Query | Plan cost | JIT | Time (psql, 5 runs) |
|---|---|---|---|---|
| 85 | old | 472,604 | 16.5 ms (emission) | 16 ms |
| 85 | new | 4,912 | none | 4.2 ms |
| 300 | old | 3,145,736 | 225 ms (inlining 46, optimization 107, emission 71) | 152 to 217 ms |
| 300 | new | 30,412 | none | 12.1 ms |

- Both queries return the same rows (255 and 900, compared by checksum).
  With JIT off, the old query takes 4.4 and 12.7 ms: the rest was all JIT.
- `/series` on the 85-series preview: median 44 ms before, 36 ms after (9
  requests each, on a Mac at a load of 8 to 9). In the app's own query log
  the suggestion query went from 27 ms median (203 ms on the first, cold
  run) to 17 ms.
- The cost grows by about 100 a series, so JIT would return past about 1,000
  series, and then only its cheap emission step until about 5,000.
- `SHOW jit` on the live database was not run: live database reads were
  refused in this session. The fix does not depend on it.
- The new test fails on the old query (cost 1,708,728 against 100,000) and
  passes on the new one.
- `python3 scripts/qa/test-local.py`: 218 files, 2,441 tests.
