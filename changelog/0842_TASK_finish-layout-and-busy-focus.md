# Task 0842: Finish responsive shelves and busy-state focus

**Status**: Complete
**Created**: 2026-10-16
**Priority**: MEDIUM
**Type**: Fix
**Depends On**: SLN-889, SLN-920, SLN-944
**Blocks**: None

## Overview

Complete the outstanding grid and focus acceptance gaps after Claude's first patches were merged.

## Implementation Details

- Recommender books, the publisher loading grid and reading suggestions use their container's available width and the existing catalogue grid.
- Keep every recommended book accessible through pagination; do not hide real catalogue members to remove a partial final row.
- The first created taxonomy item returns its id and receives focus after refreshed data and dialog restoration.
- Busy saves remain focusable in film versions/copies, art objects/whereabouts, source citation and work linking. Validation still disables invalid actions and explicit save guards prevent repeats.
- Edit-copy preparation retains a focusable busy action while unsafe or invalid states remain blocked.
- Publisher submission focuses its action outside the disabled fieldset. Async buttons acquire focus on the first Safari click and retain it on a busy click.
- Extend the busy-button regression through computed aliases, and exercise first-item focus through a rendered component.

## Completion Notes

Production build and typecheck passed. The local harness passed 18 focused tests with no skips; the final shared-button regression passed 9 tests after the Safari correction. Lint has no new errors (81 existing warnings). Container grid, alignment, design and overflow checks passed across six widths in Chromium, Firefox and WebKit. Eighteen form/focus acceptance checks passed, including a targeted WebKit proof that distinguishes the single source write from a separate refresh read. Page-weight passed on 41 available fixture routes; four routes had no fixture data and were explicitly skipped. No live catalogue writes or deployment.
