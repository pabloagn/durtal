# Task 0533: Reading page speed at 6,000 e-books

**Status**: Completed
**Created**: 2026-10-14
**Priority**: HIGH
**Type**: Fix
**Depends On**: 0457 (suggestions)
**Blocks**: None

## Overview

SLN-690. On a preview seeded with 6,000 library e-books, the dashboard took
2.6 to 3.6 s and /reading about 1.1 s. The ticket put both down to Postgres's
JIT compiler. Measured, they had two other causes:

1. **The dashboard:** a freshly seeded preview has no table statistics. The
   planner then overestimates every table, and ordinary queries cross
   `jit_above_cost` until autovacuum analyzes them, about a minute later.
   With statistics, as a long-lived database has them, "/" takes 0.3 to
   0.5 s, and its costliest query is planned at 3,425, far below the
   threshold of 100,000. Deleting the statistics brought back 4.5 s.
2. **/reading and /reading/suggestions:** the suggestion engine's variety
   step (maximal marginal relevance) compared every book with every pick:
   about two million likeness checks for 2,000 books, 250 to 680 ms of each
   request. The book query itself already runs without JIT (SLN-487) and
   takes about 170 ms.

## Implementation Details

- `scripts/qa/preview-local.py` runs `ANALYZE` after seeding, so a budget run
  times the app, not the planner's first guesses.
- `diversify` in `src/lib/reading/suggest/score.ts` is now lazy. A book's
  value only falls as picks are added, so a value measured against fewer
  picks is an upper bound. A heap holds each book at its last measured value;
  the book at the top is measured against the picks it has not seen and
  goes back, until the top is up to date, and that book is the next pick.
  Ties go to the earlier place in the score order, as before.
- The order is unchanged. A unit test compares it with the plain version on
  120 books with many tied scores, at four values of λ. On the 6,000 e-book
  seed both versions gave the same order for every λ tried.
- No database setting, query or migration changed.

## Completion Notes

On the 6,000 e-book seed (4 cores, with another test run sharing them):

| | Before | After |
|---|---|---|
| `diversify`, 2,002 books | 250 to 680 ms | 15 to 45 ms |
| / (analyzed; this PR does not change it) | 0.31 to 0.41 s | 0.41 to 0.47 s |
| /reading | 0.80 to 1.16 s | 0.42 to 0.64 s |
| /reading/suggestions | 0.89 to 1.04 s | 0.35 to 0.59 s |

The existing budget rows for "/", "/reading" and "/reading/suggestions"
(300 KB, 1,000 ms each) cover both pages; at 6,000 e-books they pass.
