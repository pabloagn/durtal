# Task 0532: Faster Import existing dry run, and reconcile a library run by its id

**Status**: Completed
**Created**: 2026-10-14
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: SLN-657 (Import existing), SLN-658
**Blocks**: SLN-498 (the load)

## Overview

Found in a cloud rehearsal of the SLN-498 load (Import existing, Part 1): 6,000
synthetic library books against 775 Durtal books, on a disposable preview.

- The dry run took 24 minutes, most of it splitting the same titles into
  trigrams for every pair it scored.
- `pnpm ebooks:reconcile` with no folder looked for the old inbox,
  `~/Downloads/eBooks`, and had no way to reconcile a Calibre run later.

## Implementation Details

- `src/lib/ebooks/match/similarity.ts`: each string's word trigrams, a query's
  trigram set and a text's word extents are kept in bounded maps (cleared at
  50,000 entries). The sets are shared, so they are typed read-only.
  `strictWordSimilarity` compares against the kept extents in the same order,
  so its result is unchanged.
- `src/lib/utils/language.ts`: `normalizeLanguage` keeps its answers (cleared
  at 1,000 values). The matcher asked it for the same few values once per pair.
- `src/lib/ebooks/ingest/run.ts`: `runReconcileScope` reads a run and the plan
  it kept, and gives the roots, host and paths its apply reconciled. The apply
  and the new command share `planPaths`.
- `scripts/ebooks/reconcile.ts`: `--run RUN_ID`. Folders and `--run` together
  are refused. With neither and no inbox, the message names both ways.
- `docs/09_INGESTION_PIPELINE.md`: the dry run's timing and `--run`.

## Completion Notes

- **Speed.** On the same preview data, run with the old code and with the new
  side by side, the 6,000-book dry run took 1,270 s before and 290 s after. A
  1,000-book run took 88 s before and 44 s after. The reports agree row for row
  on every book (tier, selection, link, work, clashes, differences, rating and
  read date).
- **Rehearsal results** (synthetic data, known answers): 691 selected, 609 link
  by themselves and all 609 are right, 82 go to review, none link wrongly.
  The apply was interrupted at 227 of 758 files and resumed, and the
  reconciliation was exact. The precision gate scored 200 of 200 right.
- **Tests.** `ebook-import-existing` checks that `runReconcileScope` gives the
  selection's files alone and is exact, and that the whole library folder is
  not. The e-book unit suites pass unchanged.
- No migration and no new package.
