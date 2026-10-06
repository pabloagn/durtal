# Task 0338: A credits index and one read for every formulation

**Status**: Completed
**Created**: 2026-10-06
**Priority**: HIGH
**Type**: Enhancement
**Depends On**: 0284 (SLN-381 timing and filter lists)
**Blocks**: None

## Overview

SLN-381's remainder. Task 0284 measured the mixed catalogue, moved the
collection filter lists out of the pages and left two items: an index for the
credited people counts, waiting for a migration slot, and a perfume page
that reads each formulation's perfumers and classification separately (two
queries per formulation).

## Implementation Details

- `src/lib/catalogue/perfume-model.ts`: `loadVariantsInheritance(workId,
  variantIds)` reads the effective perfumers and classification of every
  formulation of one perfume in two queries, with the same rows in the same
  order as `loadPerfumePerfumers` and `loadPerfumeClassification` for each.
  `loadVariants` (`src/lib/actions/perfumes.ts`) uses it.
- `work_credits` index `(role_id, person_id, work_id)`
  (`work_credit_role_person_work_idx`), migration 0073. Doc 02.

## Completion Notes

Preview with the synthetic catalogue and `--seed-large 2000` (2,000 films,
perfumes and paintings; 292,000 credits; 6,000 formulations, three per
perfume), `next dev`, repeat requests:

| Measure | main | this branch |
|---|---|---|
| `/perfumes/seed-perfume-1` | 40 queries, 210 ms SQL | 36 queries, 180 ms SQL |
| `/perfumes/seed-perfume-2` | 40 queries, 204 ms SQL | 36 queries, 188 ms SQL |
| Film directors with counts (EXPLAIN ANALYZE, warm) | 11.5 ms | 5.7 ms |
| Film cast with counts (EXPLAIN ANALYZE, warm) | 164.8 ms | 163.6 ms |

- The "main" page column is the same preview with main's
  `src/lib/actions/perfumes.ts` swapped in; the index columns drop the index
  inside a rolled-back transaction, after `VACUUM ANALYZE`.
- The cast count does not change: `film.cast` is 280,000 of the 292,000
  credits, so the planner reads the table and the time goes into counting
  distinct (person, film) pairs. A `count(distinct work_id)` form measured
  140 ms; it is left for a later change. The cast list loads only when the
  filter panel opens (task 0284).
- `src/__tests__/integration/perfume-model.test.ts`: three formulations (one
  inheriting all, one with its own perfumers, notes and accords, one with
  nothing of its own) read the same in one batch as one by one.
- `python3 scripts/qa/test-local.py`: 205 files, 2,292 tests; the first run
  failed only the new test (its two new formulations shared one identity),
  which passes after the fix with the rest of `perfume-model` (12 of 12).
- The migration was generated on a branch without 0071 and 0072. At merge it
  must be regenerated as 0073 on top of main (no hand edits).
