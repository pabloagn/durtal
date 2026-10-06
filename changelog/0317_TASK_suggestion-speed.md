# Task 0317: Faster suggestions (a follow-up to SLN-457)

**Status**: Completed
**Created**: 2026-10-06
**Priority**: MEDIUM
**Type**: Enhancement
**Depends On**: 0314 (SLN-457)
**Blocks**: None

## Overview

The review of SLN-457 (PR #122) found two costs in the suggestion engine and
asked for this follow-up against main. The variety step (`diversify`, maximal
marginal relevance) compares every pair of candidates, and each `likeness`
call built both books' term sets again. The book query ran its writers, fine
terms and editions as subqueries for each book. Neither change alters a
result.

## Implementation Details

- `src/lib/reading/suggest/score.ts`: `likenessKeys(book)` builds a book's
  taxonomy keys for likeness (the language left out) once, in a `WeakMap`;
  `likeness` counts the shared keys in one pass and takes the union as the
  two sizes minus the shared count.
- `src/lib/reading/suggest/load.ts`: the book query groups the writers
  (`au`), the six fine-term unions (`ft`), the editions' audio minutes
  (`am`, one row per edition with `distinct on`), their copies (`cp`) and the
  editions themselves (`ed`, left-joining `am` and `cp`) once for every book,
  and the main select left-joins `au`, `ft` and `ed` with the same
  `coalesce`. The order inside each aggregate is unchanged. The query still
  runs with `set local jit = off` (SLN-487).

## Completion Notes

- Same results: on a preview of the 5 Oct backup with the QA seeds (695
  books), the new book query returns the same 695 rows as the old, field by
  field, with and without a home; `suggest()` returns the same list, in the
  same order with the same scores, for the Owned scope (168 suggestions) and
  for All (613).
- `suggest()`, median of 9: Owned 4 then 2 ms, All 33 then 14 ms. The book
  query, its rows sent (`jit = off`): 120 to 127 ms then 113 to 121 ms.
- Pages, 9 requests each, on production builds of main (a663ed3c) and this
  branch with the same data: `/reading/suggestions` 154 then 141 ms median,
  `/reading/suggestions?scope=all` 186 then 155 ms, `/reading` 158 then
  143 ms. Page weight is unchanged (`/reading/suggestions` 247 KB,
  `/reading` 111 KB).
- Review measured larger gains on its preview (`suggest()` 210 then 80 ms on
  711 books, the query 161 then 73 ms). Here most of the query's time is
  building and sending its rows, which the grouped CTEs leave as they are.
- Tests: `scripts/qa/test-local.py` (every suite, a disposable PostgreSQL
  16): 223 files and 2,498 tests, none skipped, the suggestion suites
  (`reading-suggestions`, `suggest`) included. `pnpm typecheck` and
  `pnpm deadcode` are clean; `pnpm lint` has 81 warnings, as on main.
