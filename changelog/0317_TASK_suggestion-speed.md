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

RESULTS
