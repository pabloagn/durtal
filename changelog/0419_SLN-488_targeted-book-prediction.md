# Task 0419: Targeted book-page rating prediction (SLN-488)

**Status**: Completed
**Created**: 2026-10-09
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: None
**Blocks**: None

## Overview

Book pages with predictions enabled load the target book and taste-evidence neighbours instead of the full suggestion catalogue.

## Implementation Details

- `prediction-load.ts` selects authors, series, translators, recommenders, taxonomy and taste evidence for the target and rated neighbours. Other books contribute library term counts only; non-book works are excluded.
- The IDF denominator and distinct-book count for each term cover the entire library. Neighbours retain the full loader's title/ID ordering, preserving tie resolution and floating-point accumulation.
- The book page uses `getBookPredictionContext`. The prediction algorithm, initial fresh stored-gate check and existing daily compare-and-set gate evaluation remain unchanged. Copies, feedback, queue, homes and pace are omitted from this load.
- Every parity comparison remains complete and runs in memory. A mismatch emits only the target index and comparison category, without titles, IDs, ratings or term keys. Synthetic execution verifies all six failure categories and cleanup without a database.
- Browser validation exposed the existing prediction info button's clipped touch target: its 44px button was clipped to 24px and sat 10.01px off-center. The book page's prediction wrapper now uses `coarseHeight={44}`; the desktop control remains 24px. No shared component or stylesheet changed.
- Upstream layout and editorial-copy changes were merged additively. No migration or new dependency.

## Completion Notes

- Focused pure tests: 29/29. PostgreSQL integration: 14/14, zero skipped, including all taxonomy families, rating precedence, duplicate translators, long/short/absent signals, non-book isolation and concurrent gate updates. Typecheck and lint pass; lint retains 75 existing warnings.
- The available backup contains 701 books. Only a disposable restore was seeded with 34 taste-evidence neighbours. All 667 unread books match the full loader: 526 predictions, 141 nulls, zero differences in IDF, taste/order, mean, daily evaluation, ranges, text or neighbour evidence.
- Final loader timing: 3 warmup pairs and 30 measured pairs; median full load 15.48ms, targeted load 3.41ms.
- Production page benchmark uses identical seeded restores and eight unread targets uniformly spaced in catalogue order, with 3 warmup rounds and 15 measured alternating gate-on/off pairs per target. Legacy medians: off 22.45ms, on 45.27ms, paired increase 22.63ms. Final medians: off 25.27ms, on 34.28ms, paired increase 8.38ms (95th percentile 12.21ms). Every target meets the unchanged 50ms limit; all 120 measured pairs also do, with a maximum increase of 15.51ms. These are local PostgreSQL/standalone production timings.
- Short, long and absent synthetic content passes at 1280, 800, 768, 390 and 375px after actual Inter/Cirka/prose fonts load. Maximum measured alignment deviation is 0.09px, with nonempty control sets, no overflow, no text/button collisions and full 44×44px prediction hit boxes on coarse pointers. Keyboard opening, Escape and focus return pass; the whole-page interaction audit reports no failures on all three routes.
- Production and Docker builds pass. Page-weight checks pass on all 29 populated routes; four detail routes have no applicable records. Retained production source maps and served standalone chunks were verified against committed source.
- The full zero-skipped local suite and exact-head CI remain required merge gates; their final evidence is recorded on the PR. Private snapshot contents and local runtime metadata are not published.
