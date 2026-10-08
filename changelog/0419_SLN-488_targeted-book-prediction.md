# Task 0419: Targeted book-page rating prediction (SLN-488)

**Status**: In Progress
**Created**: 2026-10-09
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Book pages with predictions enabled load the target book and taste-evidence neighbours instead of the full suggestion catalogue.

## Implementation Details

- `prediction-load.ts` selects authors, series, translators, recommenders, taxonomy and taste evidence for the target and rated neighbours. Other books contribute library term counts only; non-book works are excluded.
- The IDF denominator and per-term distinct-book counts cover the entire library. Neighbours keep the full loader's title/ID ordering, preserving prediction ties and floating-point accumulation.
- The book page uses `getBookPredictionContext`. The prediction algorithm, initial stored-gate check and existing once-daily compare-and-set gate evaluation remain unchanged. The new context omits copies, feedback, queue, homes and pace queries.
- Pure fixture tests compare every unread book, prediction range, neighbour identity/order and leave-one-out evaluation. PostgreSQL parity tests include all taxonomy families, rating precedence, duplicate translators, long/short/absent signals, non-book isolation and gate freshness/races.

## Completion Notes

Focused/static checks and the coordinated production, disposable-preview, snapshot timing and full local gates are pending. No migration or new dependency.
